/**
 *
 * OBJECT_SERVER
 *
 */
'use strict';

const _ = require('lodash');
const mime = require('mime');
const glob_to_regexp = require('glob-to-regexp');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const LRUCache = require('../../util/lru_cache');
const md_store = require('./md_store');
const map_copy = require('./map_copy');
const map_writer = require('./map_writer');
const map_reader = require('./map_reader');
const map_deleter = require('./map_deleter');
const map_allocator = require('./map_allocator');
const ActivityLog = require('../analytic_services/activity_log');
const mongo_utils = require('../../util/mongo_utils');
const nodes_store = require('../node_services/nodes_store');
const system_store = require('../system_services/system_store').get_instance();
const string_utils = require('../../util/string_utils');
const mongo_functions = require('../../util/mongo_functions');
const ObjectStats = require('../analytic_services/object_stats');
const system_utils = require('../utils/system_server_utils');

/**
 *
 * create_object_upload
 *
 */
function create_object_upload(req) {
    dbg.log0('create_object_upload:', req.rpc_params);
    if (req.system && !system_utils.system_in_maintenance(req.system._id)) {
        load_bucket(req);
        var info = {
            _id: md_store.make_md_id(),
            system: req.system._id,
            bucket: req.bucket._id,
            key: req.rpc_params.key,
            content_type: req.rpc_params.content_type ||
                mime.lookup(req.rpc_params.key) ||
                'application/octet-stream',
            create_time: new Date(),
            upload_size: 0,
            cloud_synced: false,
        };
        if (req.rpc_params.size) {
            info.size = req.rpc_params.size;
        }
        if (req.rpc_params.xattr) {
            info.xattr = req.rpc_params.xattr;
        }
        return P.when(md_store.ObjectMD.findOne({
                system: req.system._id,
                bucket: req.bucket._id,
                key: req.rpc_params.key,
                deleted: null
            }))
            .then(existing_obj => {
                // check if the conditions for overwrite are met, throws if not
                check_md_conditions(req, req.rpc_params.overwrite_if, existing_obj);
                // we passed the checks, so we can delete the existing object if exists
                if (existing_obj) {
                    return delete_object_internal(existing_obj);
                }
            })
            .then(() => md_store.ObjectMD.create(info))
            .return({
                upload_id: String(info._id)
            });
    } else {
        throw req.rpc_error('SYSTEM_IN_MAINTENANCE', 'Cannot upload object when system in maintenance mode');
    }
}



/**
 *
 * LIST_MULTIPART_PARTS
 *
 */
function list_multipart_parts(req) {
    return find_object_upload(req)
        .then(obj => {
            var params = _.pick(req.rpc_params,
                'part_number_marker',
                'max_parts');
            params.obj = obj;
            return map_writer.list_multipart_parts(params);
        });
}


/**
 *
 * COMPLETE_PART_UPLOAD
 *
 * Set md5 for part (which is part of multipart upload)
 */
function complete_part_upload(req) {
    dbg.log1('complete_part_upload - etag', req.rpc_params.etag, 'req:', req);
    if (req.system && !system_utils.system_in_maintenance(req.system._id)) {
        return find_object_upload(req)
            .then(obj => {
                var params = _.pick(req.rpc_params,
                    'upload_part_number', 'etag');
                params.obj = obj;
                return map_writer.set_multipart_part_md5(params);
            });
    } else {
        throw req.rpc_error('SYSTEM_IN_MAINTENANCE', 'Cannot upload object parts when system in maintenance mode');
    }
}

/**
 *
 * complete_object_upload
 *
 */
function complete_object_upload(req) {
    var obj;
    var obj_etag = req.rpc_params.etag || '';
    if (req.system && !system_utils.system_in_maintenance(req.system._id)) {
        return find_object_upload(req)
            .then(obj_arg => {
                obj = obj_arg;
                if (req.rpc_params.fix_parts_size) {
                    return map_writer.calc_multipart_md5(obj)
                        .then(aggregated_md5 => {
                            obj_etag = aggregated_md5;
                            dbg.log0('aggregated_md5', obj_etag);
                            return map_writer.fix_multipart_parts(obj);
                        });
                } else {
                    dbg.log0('complete_object_upload no fix for', obj);
                    return obj.size;
                }
            })
            .then(object_size => {
                ActivityLog.create({
                    system: req.system,
                    level: 'info',
                    event: 'obj.uploaded',
                    obj: obj,
                    actor: req.account && req.account._id,
                    desc: `${obj.key} was uploaded by ${req.account && req.account.email}`,
                });

                return md_store.ObjectMD.collection.updateOne({
                    _id: obj._id
                }, {
                    $set: {
                        size: object_size || obj.size,
                        etag: obj_etag
                    },
                    $unset: {
                        upload_size: 1
                    }
                });
            })
            .then(() => {
                system_store.make_changes_in_background({
                    update: {
                        buckets: [{
                            _id: obj.bucket,
                            $inc: {
                                'stats.writes': 1
                            }
                        }]
                    }
                });
                return {
                    etag: obj_etag
                };
            })
            .catch(err => {
                dbg.error('complete_object_upload: ERROR', err.stack || err);
                throw err;
            });
    } else {
        throw req.rpc_error('SYSTEM_IN_MAINTENANCE', 'Cannot upload object parts when system in maintenance mode');
    }
}


/**
 *
 * abort_object_upload
 *
 */
function abort_object_upload(req) {
    //TODO: Maybe mark the ul as aborted so we won't continue to allocate parts
    //and only then delete. Thus not having currently allocated parts deleted,
    //while continuing to ul resulting in a partial file
    return find_object_upload(req)
        .then(obj => delete_object_internal(obj))
        .return();
}



/**
 *
 * ALLOCATE_OBJECT_PARTS
 *
 */
function allocate_object_parts(req) {
    if (req.system && !system_utils.system_in_maintenance(req.system._id)) {
        return find_cached_object_upload(req)
            .then(obj => {
                let allocator = new map_allocator.MapAllocator(
                    req.bucket,
                    obj,
                    req.rpc_params.parts);
                return allocator.run();
            });
    } else {
        throw req.rpc_error('SYSTEM_IN_MAINTENANCE', 'Cannot allocate object parts when system in maintenance mode');
    }
}


/**
 *
 * FINALIZE_OBJECT_PART
 *
 */
function finalize_object_parts(req) {
    if (req.system && !system_utils.system_in_maintenance(req.system._id)) {
        return find_cached_object_upload(req)
            .then(obj => {
                return map_writer.finalize_object_parts(
                    req.bucket,
                    obj,
                    req.rpc_params.parts);
            });
    } else {
        throw req.rpc_error('SYSTEM_IN_MAINTENANCE', 'Cannot upload object parts when system in maintenance mode');
    }
}


/**
 *
 * copy_object
 *
 */
function copy_object(req) {
    dbg.log0('copy_object', req.rpc_params);
    if (req.system && !system_utils.system_in_maintenance(req.system._id)) {
        load_bucket(req);
        var source_bucket = req.system.buckets_by_name[req.rpc_params.source_bucket];
        if (!source_bucket) {
            throw req.rpc_error('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.source_bucket);
        }
        var create_info;
        var existing_obj;
        var source_obj;
        return P.join(
                md_store.ObjectMD.findOne({
                    system: req.system._id,
                    bucket: req.bucket._id,
                    key: req.rpc_params.key,
                    deleted: null
                }),
                md_store.ObjectMD.findOne({
                    system: req.system._id,
                    bucket: source_bucket._id,
                    key: req.rpc_params.source_key,
                    deleted: null
                }))
            .spread((existing_obj_arg, source_obj_arg) => {
                existing_obj = existing_obj_arg;
                source_obj = source_obj_arg;
                if (!source_obj) {
                    throw req.rpc_error('NO_SUCH_OBJECT',
                        'No such object: ' + req.rpc_params.source_bucket +
                        ' ' + req.rpc_params.source_key);
                }
                create_info = {
                    _id: md_store.make_md_id(),
                    system: req.system._id,
                    bucket: req.bucket._id,
                    key: req.rpc_params.key,
                    size: source_obj.size,
                    etag: source_obj.etag,
                    create_time: new Date(),
                    content_type: req.rpc_params.content_type ||
                        source_obj.content_type ||
                        mime.lookup(req.rpc_params.key) ||
                        'application/octet-stream',
                    upload_size: 0,
                    cloud_synced: false,
                };
                if (req.rpc_params.xattr_copy) {
                    create_info.xattr = source_obj.xattr;
                } else if (req.rpc_params.xattr) {
                    create_info.xattr = req.rpc_params.xattr;
                }
                // check if the conditions for overwrite are met, throws if not
                check_md_conditions(req, req.rpc_params.overwrite_if, existing_obj);
                check_md_conditions(req, req.rpc_params.source_if, source_obj);
                // we passed the checks, so we can delete the existing object if exists
                if (existing_obj) {
                    return delete_object_internal(existing_obj);
                }
            })
            .then(() => md_store.ObjectMD.create(create_info))
            .then(() => {
                let copy = new map_copy.MapCopy(source_obj, create_info);
                return copy.run();
            })
            .then(() => {
                ActivityLog.create({
                    system: req.system,
                    level: 'info',
                    event: 'obj.uploaded',
                    obj: create_info._id,
                    actor: req.account && req.account._id,
                    desc: `${create_info.key} was copied by ${req.account && req.account.email}`,
                });
                // mark the new object not in upload mode
                return md_store.ObjectMD.collection.updateOne({
                    _id: create_info._id
                }, {
                    $unset: {
                        upload_size: 1
                    }
                });
            })
            .then(() => {
                return {
                    source_md: get_object_info(source_obj)
                };
            });
    } else {
        throw req.rpc_error('SYSTEM_IN_MAINTENANCE', 'Cannot upload object parts when system in maintenance mode');
    }
}

/**
 *
 * READ_OBJECT_MAPPINGS
 *
 */
function read_object_mappings(req) {
    var obj;
    var reply = {};

    return find_object_md(req)
        .then(obj_arg => {
            obj = obj_arg;
            reply.object_md = get_object_info(obj);
            var params = _.pick(req.rpc_params,
                'start',
                'end',
                'skip',
                'limit',
                'adminfo');
            params.obj = obj;
            // allow adminfo only to admin!
            if (params.adminfo && req.role !== 'admin') {
                params.adminfo = false;
            }
            return map_reader.read_object_mappings(params);
        })
        .then(parts => {
            reply.parts = parts;
            // when called from admin console, we do not update the stats
            // so that viewing the mapping in the ui will not increase read count
            // We do count the number of parts and return them
            if (req.rpc_params.adminfo) {
                return P.when(md_store.ObjectPart.collection.count({
                        obj: obj._id,
                        deleted: null,
                    }))
                    .then(c => {
                        reply.total_parts = c;
                    });
            } else {
                system_store.make_changes_in_background({
                    update: {
                        buckets: [{
                            _id: obj.bucket,
                            $inc: {
                                'stats.reads': 1
                            }
                        }]
                    }
                });
                return P.when(md_store.ObjectMD.collection.updateOne({
                    _id: obj._id
                }, {
                    $inc: {
                        'stats.reads': 1
                    }
                }));
            }
        })
        .return(reply);
}


/**
 *
 * READ_NODE_MAPPINGS
 *
 */
function read_node_mappings(req) {
    var node;
    return nodes_store.find_node_by_name(req)
        .then(
            node_arg => {
                node = node_arg;
                var params = _.pick(req.rpc_params, 'skip', 'limit');
                params.node = node;
                return map_reader.read_node_mappings(params);
            }
        )
        .then(objects => {
            if (req.rpc_params.adminfo) {
                return md_store.DataBlock.collection.count({
                        node: node._id,
                        deleted: null
                    })
                    .then(count => ({
                        objects: objects,
                        total_count: count
                    }));
            } else {
                return {
                    objects: objects
                };
            }
        });
}


/**
 *
 * READ_OBJECT_MD
 *
 */
function read_object_md(req) {
    dbg.log0('read_obj(1):', req.rpc_params);
    var objid;
    return find_object_md(req)
        .then(obj => {
            objid = obj._id;
            dbg.log0('read_obj:', obj);
            return get_object_info(obj);
        })
        .then(info => {
            if (!req.rpc_params.get_parts_count) {
                return info;
            } else {
                return P.when(md_store.ObjectPart.count({
                        obj: objid,
                        deleted: null,
                    }))
                    .then(c => {
                        info.total_parts_count = c;
                        return info;
                    });
            }
        });
}



/**
 *
 * UPDATE_OBJECT_MD
 *
 */
function update_object_md(req) {
    dbg.log0('update object md', req.rpc_params);
    if (req.system && !system_utils.system_in_maintenance(req.system._id)) {
        return find_object_md(req)
            .then((obj) => {
                var updates = _.pick(req.rpc_params, 'content_type', 'xattr');
                return obj.update(updates).exec();
            })
            .then(obj => mongo_utils.check_entity_not_deleted(req, 'object', obj))
            .thenResolve();
    } else {
        throw req.rpc_error('SYSTEM_IN_MAINTENANCE', 'Cannot update object when system in maintenance mode');
    }
}



/**
 *
 * DELETE_OBJECT
 *
 */
function delete_object(req) {
    if (req.system && !system_utils.system_in_maintenance(req.system._id)) {
        load_bucket(req);
        let obj_to_delete;
        return P.fcall(() => {
                var query = _.omit(object_md_query(req), 'deleted');
                return md_store.ObjectMD.findOne(query).exec();
            })
            .then(obj => mongo_utils.check_entity_not_found(req, 'object', obj))
            .then(obj => {
                obj_to_delete = obj;
                delete_object_internal(obj);
            })
            .then(() => {
                ActivityLog.create({
                    system: req.system,
                    level: 'info',
                    event: 'obj.deleted',
                    obj: obj_to_delete,
                    actor: req.account && req.account._id,
                    desc: `${obj_to_delete.key} was deleted by ${req.account && req.account.email}`,
                });
            })
            .return();
    } else {
        throw req.rpc_error('SYSTEM_IN_MAINTENANCE', 'Cannot delete object when system in maintenance mode');
    }
}


/**
 *
 * DELETE_MULTIPLE_OBJECTS
 * delete multiple objects
 *
 */
function delete_multiple_objects(req) {
    dbg.log2('delete_multiple_objects: keys =', req.params.keys);
    if (req.system && !system_utils.system_in_maintenance(req.system._id)) {
        load_bucket(req);
        // TODO: change it to perform changes in one transaction
        return P.all(_.map(req.params.keys, function(key) {
                return P.fcall(() => {
                        var query = {
                            system: req.system._id,
                            bucket: req.bucket._id,
                            key: key
                        };
                        return md_store.ObjectMD.findOne(query).exec();
                    })
                    .then(obj => mongo_utils.check_entity_not_found(req, 'object', obj))
                    .then(obj => delete_object_internal(obj));
            }))
            .return();
    } else {
        throw req.rpc_error('SYSTEM_IN_MAINTENANCE', 'Cannot delete multiple objects when system in maintenance mode');
    }
}


/**
 * return a regexp pattern to be appended to a prefix
 * to make it match "prefix/file" or "prefix/dir/"
 * but with a custom delimiter instead of /
 * @param delimiter - a single character.
 */
function one_level_delimiter(delimiter) {
    var d = string_utils.escapeRegExp(delimiter[0]);
    return '[^' + d + ']*' + d + '?$';
}

function add_s3_usage_report(req) {
    return P.fcall(() => {
            return ObjectStats.create({
                system: req.system,
                s3_usage_info: req.rpc_params.s3_usage_info,
            });
        }).return();
}

function remove_s3_usage_reports(req) {
    var q = ObjectStats.remove();
    if (req.rpc_params.till_time) {
        // query backwards from given time
        req.rpc_params.till_time = new Date(req.rpc_params.till_time);
        q.where('time').lte(req.rpc_params.till_time);
    } else {
        throw req.rpc_error('NO TILL_TIME', 'Parameters do not have till_time: ' + req.rpc_params);
    }
    //q.limit(req.rpc_params.limit || 10);
    return P.when(q.exec())
        .catch(err => {
            throw req.rpc_error('COULD NOT DELETE REPORTS', 'Error Deleting Reports: ' + err);
        })
        .return();
}

function read_s3_usage_report(req) {
    var q = ObjectStats.find({deleted: null}).lean();
    if (req.rpc_params.from_time) {
        // query backwards from given time
        req.rpc_params.from_time = new Date(req.rpc_params.from_time);
        q.where('time').gt(req.rpc_params.from_time).sort('-time');
    } else {
        // query backward from last time
        q.sort('-time');
    }
    //q.limit(req.rpc_params.limit || 10);
    return P.when(q.exec())
        .then(reports => {
            reports = _.map(reports, report_item => {
                let report = _.pick(report_item, 'system', 's3_usage_info');
                report.time = report_item.time.getTime();
                return report;
            });
            // if (reverse) {
            //     reports.reverse();
            // }
            return {
                reports: reports
            };
        });
}

/**
 * common case is / as delimiter
 */
var ONE_LEVEL_SLASH_DELIMITER = one_level_delimiter('/');


/**
 *
 * LIST_OBJECTS
 *
 */
function list_objects(req) {
    dbg.log0('list_objects', req.rpc_params);
    var prefix = req.rpc_params.prefix || '';
    let escaped_prefix = string_utils.escapeRegExp(prefix);
    var delimiter = req.rpc_params.delimiter || '';
    load_bucket(req);
    return P.fcall(() => {
            var info = _.omit(object_md_query(req), 'key');
            var common_prefixes_query;

            if (delimiter) {
                // find objects that match "prefix***" or "prefix***/"
                let one_level = delimiter !== '/' ?
                    one_level_delimiter(delimiter) :
                    ONE_LEVEL_SLASH_DELIMITER;
                info.key = new RegExp('^' + escaped_prefix + one_level);

                // we need another query to find common prefixes
                // we go over objects with key that starts with prefix
                // and only emit the next level delimited part of the key
                // for example with prefix /Users/ and key /Users/tumtum/shlumper
                // the emitted key will be just tumtum.
                // this is used by s3 protocol to return folder structure
                // even if there is no explicit empty object with the folder name.
                common_prefixes_query = md_store.ObjectMD.collection.mapReduce(
                    mongo_functions.map_key_with_prefix_delimiter,
                    mongo_functions.reduce_noop, {
                        query: {
                            system: req.system._id,
                            bucket: req.bucket._id,
                            key: new RegExp('^' + escaped_prefix),
                            deleted: null
                        },
                        scope: {
                            prefix: prefix,
                            delimiter: delimiter,
                        },
                        out: {
                            inline: 1
                        }
                    });
            } else if (prefix) {
                info.key = new RegExp('^' + escaped_prefix);
            } else if (req.rpc_params.key_query) {
                info.key = new RegExp(string_utils.escapeRegExp(req.rpc_params.key_query), 'i');
            } else if (req.rpc_params.key_regexp) {
                info.key = new RegExp(req.rpc_params.key_regexp);
            } else if (req.rpc_params.key_glob) {
                info.key = glob_to_regexp(req.rpc_params.key_glob);
            } else if (req.rpc_params.key_prefix) {
                info.key = new RegExp('^' + string_utils.escapeRegExp(req.rpc_params.key_prefix));
            }

            // allow filtering of uploading/non-uploading objects
            if (typeof(req.rpc_params.upload_mode) === 'boolean') {
                info.upload_size = {
                    $exists: req.rpc_params.upload_mode
                };
            }

            var skip = req.rpc_params.skip;
            var limit = req.rpc_params.limit;
            dbg.log0('list_objects params:', req.rpc_params, 'query:', info);
            var find = md_store.ObjectMD.find(info);
            if (skip) {
                find.skip(skip);
            }
            if (limit) {
                find.limit(limit);
            }
            var sort = req.rpc_params.sort;
            if (sort) {
                var order = (req.rpc_params.order === -1) ? -1 : 1;
                var sort_opt = {};
                sort_opt[sort] = order;
                find.sort(sort_opt);
            }

            return P.join(
                find.exec(),
                req.rpc_params.pagination && md_store.ObjectMD.count(info),
                common_prefixes_query
            );
        })
        .spread(function(objects, total_count, common_prefixes_res) {
            let res = {};
            let prefix_map;
            let should_compact_objects = false;
            if (common_prefixes_res) {
                prefix_map = _.keyBy(common_prefixes_res, r => prefix + r._id + delimiter);
                res.common_prefixes = _.keys(prefix_map);
            } else {
                prefix_map = {};
            }
            res.objects = _.map(objects, obj => {
                if (obj.key in prefix_map) {
                    // we filter out objects that are folder placeholders
                    // which means that have size 0 and already included as prefixes
                    // this is to avoid showing them as duplicates
                    should_compact_objects = true;
                    return;
                }
                return {
                    key: obj.key,
                    info: get_object_info(obj),
                };
            });
            if (should_compact_objects) {
                res.objects = _.compact(res.objects);
            }
            if (req.rpc_params.pagination) {
                res.total_count = total_count;
            }
            return res;
        });
}

//mark all objects on specific bucket for sync
//TODO:: use mongoDB bulk instead of two mongoose ops
function set_all_files_for_sync(sysid, bucketid) {
    dbg.log2('marking all objects on sys', sysid, 'bucket', bucketid, 'as sync needed');
    //Mark all "live" objects to be cloud synced
    return P.fcall(() => md_store.ObjectMD.update({
            system: sysid,
            bucket: bucketid,
            cloud_synced: true,
            deleted: null,
        }, {
            cloud_synced: false
        }, {
            multi: true
        }).exec())
        .then(() => md_store.ObjectMD.update({
            //Mark all "previous" deleted objects as not needed for cloud sync
            system: sysid,
            bucket: bucketid,
            cloud_synced: false,
            deleted: {
                $ne: null
            },
        }, {
            cloud_synced: true
        }, {
            multi: true
        }).exec());
}
// UTILS //////////////////////////////////////////////////////////


function get_object_info(md) {
    var info = _.pick(md, 'size', 'content_type', 'etag', 'xattr');
    info.version_id = String(md._id);
    info.size = info.size || 0;
    info.content_type = info.content_type || 'application/octet-stream';
    info.etag = info.etag || '';
    info.create_time = md.create_time.getTime();
    if (_.isNumber(md.upload_size)) {
        info.upload_size = md.upload_size;
    }
    if (md.stats) {
        info.stats = _.pick(md.stats, 'reads');
    }
    return info;
}

function load_bucket(req) {
    var bucket = req.system.buckets_by_name[req.rpc_params.bucket];
    if (!bucket) {
        throw req.rpc_error('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.bucket);
    }
    req.check_bucket_permission(bucket);
    req.bucket = bucket;
}

function object_md_query(req) {
    return {
        system: req.system._id,
        bucket: req.bucket._id,
        key: req.rpc_params.key,
        deleted: null
    };
}

function find_object_md(req) {
    load_bucket(req);
    return P.fcall(() => {
            return md_store.ObjectMD.findOne(object_md_query(req)).exec();
        })
        .then(obj => mongo_utils.check_entity_not_deleted(req, 'object', obj));
}

function find_object_upload(req) {
    load_bucket(req);
    return P.fcall(() => {
            return md_store.ObjectMD.findOne({
                _id: md_store.make_md_id(req.rpc_params.upload_id),
                system: req.system._id,
                bucket: req.bucket._id,
                deleted: null
            }).exec();
        })
        .then(obj => check_object_upload_mode(req, obj));
}

// short living cache for objects
// the purpose is to reduce hitting the DB many many times per second during upload/download.
const object_md_cache = new LRUCache({
    name: 'ObjectMDCache',
    max_usage: 1000,
    expiry_ms: 1000, // 1 second of blissfull ignorance
    load: function(object_id) {
        console.log('ObjectMDCache: load', object_id);
        return P.when(md_store.ObjectMD.findOne({
            _id: object_id,
            deleted: null,
        }).exec());
    }
});

function find_cached_object_upload(req) {
    load_bucket(req);
    return P.fcall(() => {
            return object_md_cache.get_with_cache(req.rpc_params.upload_id);
        })
        .then(obj => check_object_upload_mode(req, obj));
}

function check_object_upload_mode(req, obj) {
    if (!obj || obj.deleted) {
        throw req.rpc_error('NO_SUCH_UPLOAD',
            'No such upload id: ' + req.rpc_params.upload_id);
    }
    if (!_.isNumber(obj.upload_size)) {
        throw req.rpc_error('NO_SUCH_UPLOAD',
            'Object not in upload mode: ' + obj.key +
            ' upload_size ' + obj.upload_size);
    }
    return obj;
}

function delete_object_internal(obj) {
    return P.fcall(() => {
            return obj.update({
                deleted: new Date(),
                cloud_synced: false
            }).exec();
        })
        .then(() => map_deleter.delete_object_mappings(obj))
        .return();
}

function check_md_conditions(req, conditions, obj) {
    if (!conditions) {
        return;
    }
    if (conditions.if_modified_since) {
        if (!obj ||
            conditions.if_modified_since < obj._id.getTimestamp().getTime()) {
            throw req.rpc_error('IF_MODIFIED_SINCE');
        }
    }
    if (conditions.if_unmodified_since) {
        if (!obj ||
            conditions.if_unmodified_since > obj._id.getTimestamp().getTime()) {
            throw req.rpc_error('IF_UNMODIFIED_SINCE');
        }
    }
    if (conditions.if_match_etag) {
        if (!obj ||
            (conditions.if_match_etag !== '*' &&
                conditions.if_match_etag !== obj.etag)) {
            throw req.rpc_error('IF_MATCH_ETAG');
        }
    }
    if (conditions.if_none_match_etag) {
        if (obj &&
            (conditions.if_none_match_etag === '*' ||
                conditions.if_none_match_etag === obj.etag)) {
            throw req.rpc_error('IF_NONE_MATCH_ETAG');
        }
    }
}


// EXPORTS
// object upload
exports.create_object_upload = create_object_upload;
exports.read_s3_usage_report = read_s3_usage_report;
exports.add_s3_usage_report = add_s3_usage_report;
exports.remove_s3_usage_reports = remove_s3_usage_reports;
exports.complete_object_upload = complete_object_upload;
exports.abort_object_upload = abort_object_upload;
exports.list_multipart_parts = list_multipart_parts;
exports.allocate_object_parts = allocate_object_parts;
exports.finalize_object_parts = finalize_object_parts;
exports.complete_part_upload = complete_part_upload;
exports.copy_object = copy_object;
// read
exports.read_object_mappings = read_object_mappings;
exports.read_node_mappings = read_node_mappings;
// object meta-data
exports.read_object_md = read_object_md;
exports.update_object_md = update_object_md;
exports.delete_object = delete_object;
exports.delete_multiple_objects = delete_multiple_objects;
exports.list_objects = list_objects;
// cloud sync related
exports.set_all_files_for_sync = set_all_files_for_sync;
