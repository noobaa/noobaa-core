/* jshint node:true */
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');
var mime = require('mime');
var MapAllocator = require('./mapper/map_allocator');
var MapCopy = require('./mapper/map_copy');
var map_writer = require('./mapper/map_writer');
var map_reader = require('./mapper/map_reader');
var map_deleter = require('./mapper/map_deleter');
var system_store = require('./stores/system_store');
var glob_to_regexp = require('glob-to-regexp');
var dbg = require('../util/debug_module')(__filename);
var string_utils = require('../util/string_utils');
var mongo_functions = require('../util/mongo_functions');

/**
 *
 * OBJECT_SERVER
 *
 */
var object_server = {

    // object upload
    create_object_upload: create_object_upload,
    complete_object_upload: complete_object_upload,
    abort_object_upload: abort_object_upload,
    list_multipart_parts: list_multipart_parts,
    allocate_object_parts: allocate_object_parts,
    finalize_object_parts: finalize_object_parts,
    complete_part_upload: complete_part_upload,
    report_bad_block: report_bad_block,
    copy_object: copy_object,

    // read
    read_object_mappings: read_object_mappings,

    // object meta-data
    read_object_md: read_object_md,
    update_object_md: update_object_md,
    delete_object: delete_object,
    delete_multiple_objects: delete_multiple_objects,
    list_objects: list_objects,

    //cloud sync related
    set_all_files_for_sync: set_all_files_for_sync
};

module.exports = object_server;



/**
 *
 * create_object_upload
 *
 */
function create_object_upload(req) {
    dbg.log0('create_object_upload:', req.rpc_params);
    load_bucket(req);
    var info = {
        _id: db.new_object_id(),
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
    return P.when(db.ObjectMD.findOne({
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
        .then(() => db.ObjectMD.create(info))
        .return({
            upload_id: String(info._id)
        });
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
    return find_object_upload(req)
        .then(obj => {
            var params = _.pick(req.rpc_params,
                'upload_part_number', 'etag');
            params.obj = obj;
            return map_writer.set_multipart_part_md5(params);
        });
}

/**
 *
 * complete_object_upload
 *
 */
function complete_object_upload(req) {
    var obj;
    var obj_etag = req.rpc_params.etag || '';

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
            }
        })
        .then(object_size => {
            db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'obj.uploaded',
                obj: obj,
            });

            return db.ObjectMD.collection.updateOne({
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
    return find_cached_object_upload(req)
        .then(obj => {
            let allocator = new MapAllocator(
                req.bucket,
                obj,
                req.rpc_params.parts);
            return allocator.run();
        });
}


/**
 *
 * FINALIZE_OBJECT_PART
 *
 */
function finalize_object_parts(req) {
    return find_cached_object_upload(req)
        .then(obj => {
            return map_writer.finalize_object_parts(
                req.bucket,
                obj,
                req.rpc_params.parts);
        });
}


function report_bad_block(req) {
    return find_object_md(req)
        .then(obj => {
            var params = req.rpc_params;
            params.obj = obj;
            return map_writer.report_bad_block(params);
        })
        .then(new_block => {
            if (new_block) {
                return {
                    new_block: new_block
                };
            }
        });
}


/**
 *
 * copy_object
 *
 */
function copy_object(req) {
    dbg.log0('copy_object', req.rpc_params);
    load_bucket(req);
    var source_bucket = req.system.buckets_by_name[req.rpc_params.source_bucket];
    if (!source_bucket) {
        throw req.rpc_error('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.source_bucket);
    }
    var create_info;
    var existing_obj;
    var source_obj;
    return P.join(
            db.ObjectMD.findOne({
                system: req.system._id,
                bucket: req.bucket._id,
                key: req.rpc_params.key,
                deleted: null
            }),
            db.ObjectMD.findOne({
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
                _id: db.new_object_id(),
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
        .then(() => db.ObjectMD.create(create_info))
        .then(() => {
            let map_copy = new MapCopy(source_obj, create_info);
            return map_copy.run();
        })
        .then(() => {
            db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'obj.uploaded',
                obj: create_info._id,
            });
            // mark the new object not in upload mode
            return db.ObjectMD.collection.updateOne({
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
}


/**
 *
 * READ_OBJECT_MAPPING
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
                return P.when(db.ObjectPart.collection.count({
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
                return P.when(db.ObjectMD.collection.updateOne({
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
                return P.when(db.ObjectPart.count({
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
    return find_object_md(req)
        .then((obj) => {
            var updates = _.pick(req.rpc_params, 'content_type', 'xattr');
            return obj.update(updates).exec();
        })
        .then(db.check_not_deleted(req, 'object'))
        .thenResolve();
}



/**
 *
 * DELETE_OBJECT
 *
 */
function delete_object(req) {
    load_bucket(req);
    return P.fcall(() => {
            var query = _.omit(object_md_query(req), 'deleted');
            return db.ObjectMD.findOne(query).exec();
        })
        .then(db.check_not_found(req, 'object'))
        .then(obj => delete_object_internal(obj))
        .return();
}


/**
 *
 * DELETE_MULTIPLE_OBJECTS
 * delete multiple objects
 *
 */
function delete_multiple_objects(req) {
    dbg.log2('delete_multiple_objects: keys =', req.params.keys);
    load_bucket(req);
    // TODO: change it to perform changes in one transaction
    return P.all(_.map(req.params.keys, function(key) {
            return P.fcall(() => {
                    var query = {
                        system: req.system._id,
                        bucket: req.bucket._id,
                        key: key
                    };
                    return db.ObjectMD.findOne(query).exec();
                })
                .then(db.check_not_found(req, 'object'))
                .then(obj => delete_object_internal(obj));
        }))
        .return();
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
                common_prefixes_query = db.ObjectMD.collection.mapReduce(
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
            var find = db.ObjectMD.find(info);
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
                req.rpc_params.pagination && db.ObjectMD.count(info),
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
    return P.fcall(() => db.ObjectMD.update({
            system: sysid,
            bucket: bucketid,
            cloud_synced: true,
            deleted: null,
        }, {
            cloud_synced: false
        }, {
            multi: true
        }).exec())
        .then(() => db.ObjectMD.update({
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
            return db.ObjectMD.findOne(object_md_query(req)).exec();
        })
        .then(db.check_not_deleted(req, 'object'));
}

function find_object_upload(req) {
    load_bucket(req);
    return P.fcall(() => {
            return db.ObjectMD.findOne({
                _id: db.new_object_id(req.rpc_params.upload_id),
                system: req.system._id,
                bucket: req.bucket._id,
                deleted: null
            }).exec();
        })
        .then(obj => check_object_upload_mode(req, obj));
}

function find_cached_object_upload(req) {
    load_bucket(req);
    return P.fcall(() => {
            return db.ObjectMDCache.get_with_cache(req.rpc_params.upload_id);
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
