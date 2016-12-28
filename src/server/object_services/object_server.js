/**
 *
 * OBJECT_SERVER
 *
 */
'use strict';

const _ = require('lodash');
const url = require('url');
const mime = require('mime');
const moment = require('moment');
const ip_module = require('ip');
const glob_to_regexp = require('glob-to-regexp');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const LRUCache = require('../../util/lru_cache');
const md_store = require('./md_store');
const map_copy = require('./map_copy');
const RpcError = require('../../rpc/rpc_error');
const map_writer = require('./map_writer');
const map_reader = require('./map_reader');
const map_deleter = require('./map_deleter');
const Dispatcher = require('../notifications/dispatcher');
const mongo_utils = require('../../util/mongo_utils');
const cloud_utils = require('../../util/cloud_utils');
const ObjectStats = require('../analytic_services/object_stats');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const string_utils = require('../../util/string_utils');
const promise_utils = require('../../util/promise_utils');
const map_allocator = require('./map_allocator');
const mongo_functions = require('../../util/mongo_functions');
const http_utils = require('../../util/http_utils');
const system_server_utils = require('../utils/system_server_utils');

/**
 *
 * create_object_upload
 *
 */
function create_object_upload(req) {
    dbg.log0('create_object_upload:', req.rpc_params);
    throw_if_maintenance(req);
    load_bucket(req);
    var info = {
        _id: md_store.make_md_id(),
        system: req.system._id,
        bucket: req.bucket._id,
        key: req.rpc_params.key,
        content_type: req.rpc_params.content_type ||
            mime.lookup(req.rpc_params.key) ||
            'application/octet-stream',
        upload_started: new Date(),
        upload_size: 0,
        cloud_synced: false,
    };
    if (req.rpc_params.size) {
        info.size = req.rpc_params.size;
    }
    if (req.rpc_params.xattr) {
        info.xattr = req.rpc_params.xattr;
    }
    return P.resolve(md_store.ObjectMD.findOne({
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
    throw_if_maintenance(req);
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
    throw_if_maintenance(req);
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
            Dispatcher.instance().activity({
                system: req.system._id,
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
                    create_time: new Date(),
                    etag: obj_etag
                },
                $unset: {
                    upload_size: 1,
                    upload_started: 1,
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
                        },
                        $set: {
                            'stats.last_write': new Date()
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
    throw_if_maintenance(req);
    return find_cached_object_upload(req)
        .then(obj => {
            let allocator = new map_allocator.MapAllocator(
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
    throw_if_maintenance(req);
    return find_cached_object_upload(req)
        .then(obj => {
            return map_writer.finalize_object_parts(
                req.bucket,
                obj,
                req.rpc_params.parts);
        });
}


/**
 *
 * copy_object
 *
 */
function copy_object(req) {
    dbg.log0('copy_object', req.rpc_params);
    throw_if_maintenance(req);
    load_bucket(req);
    var source_bucket = req.system.buckets_by_name[req.rpc_params.source_bucket];
    if (!source_bucket) {
        throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.source_bucket);
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
                throw new RpcError('NO_SUCH_OBJECT',
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
                upload_started: new Date(),
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
            Dispatcher.instance().activity({
                system: req.system._id,
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
                $set: {
                    create_time: new Date()
                },
                $unset: {
                    upload_size: 1,
                    upload_started: 1,
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
                return P.resolve(md_store.ObjectPart.collection.count({
                        obj: obj._id,
                        deleted: null,
                    }))
                    .then(c => {
                        reply.total_parts = c;
                    });
            } else {
                let date = new Date();
                system_store.make_changes_in_background({
                    update: {
                        buckets: [{
                            _id: obj.bucket,
                            $inc: {
                                'stats.reads': 1
                            },
                            $set: {
                                'stats.last_read': date
                            }
                        }]
                    }
                });
                return P.resolve(md_store.ObjectMD.collection.updateOne({
                    _id: obj._id
                }, {
                    $inc: {
                        'stats.reads': 1
                    },
                    $set: {
                        'stats.last_read': new Date()
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
    return nodes_client.instance().read_node_by_name(req.system._id, req.params.name)
        .then(node_arg => {
            node = node_arg;
            var params = _.pick(req.rpc_params, 'skip', 'limit');
            params.node_id = node._id;
            params.system = req.system;
            return map_reader.read_node_mappings(params);
        })
        .then(objects => {
            if (req.rpc_params.adminfo) {
                return md_store.DataBlock.collection.count({
                        system: req.system._id,
                        node: mongo_utils.make_object_id(node._id),
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
    const adminfo = req.rpc_params.adminfo;
    let info;
    return find_object_md(req)
        .then(obj => {
            info = get_object_info(obj);
            if (!adminfo || req.role !== 'admin') return;

            // using the internal IP doesn't work when there is a different external ip
            // or when the intention is to use dns name.
            const endpoint =
                adminfo.signed_url_endpoint ||
                url.parse(req.system.base_address || '').hostname ||
                ip_module.address();
            const account_keys = req.account.access_keys[0];
            info.s3_signed_url = cloud_utils.get_signed_url({
                endpoint: endpoint,
                access_key: account_keys.access_key,
                secret_key: account_keys.secret_key,
                bucket: req.rpc_params.bucket,
                key: req.rpc_params.key
            });

            return map_reader.read_object_mappings({
                    obj: obj,
                    adminfo: true
                })
                .then(parts => {
                    info.total_parts_count = parts.length;
                    info.capacity_size = _.reduce(parts, (sum_capacity, part) => {
                        let frag = part.chunk.frags[0];
                        return sum_capacity + (frag.size * frag.blocks.length);
                    }, 0);
                });
        })
        .then(() => info);
}



/**
 *
 * UPDATE_OBJECT_MD
 *
 */
function update_object_md(req) {
    dbg.log0('update object md', req.rpc_params);
    throw_if_maintenance(req);
    return find_object_md(req)
        .then(obj => {
            var updates = _.pick(req.rpc_params, 'content_type', 'xattr');
            return obj.update(updates).exec();
        })
        .then(obj => mongo_utils.check_entity_not_deleted(obj, 'object'))
        .return();
}



/**
 *
 * DELETE_OBJECT
 *
 */
function delete_object(req) {
    throw_if_maintenance(req);
    load_bucket(req);
    let obj_to_delete;
    return P.fcall(() => {
            var query = _.omit(object_md_query(req), 'deleted');
            return md_store.ObjectMD.findOne(query).exec();
        })
        .then(obj => mongo_utils.check_entity_not_found(obj, 'object'))
        .then(obj => {
            obj_to_delete = obj;
            delete_object_internal(obj);
        })
        .then(() => {
            Dispatcher.instance().activity({
                system: req.system._id,
                level: 'info',
                event: 'obj.deleted',
                obj: obj_to_delete,
                actor: req.account && req.account._id,
                desc: `${obj_to_delete.key} was deleted by ${req.account && req.account.email}`,
            });
        })
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
    throw_if_maintenance(req);
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
                .then(obj => mongo_utils.check_entity_not_found(obj, 'object'))
                .then(obj => delete_object_internal(obj));
        }))
        .return();
}

/**
 *
 * DELETE_MULTIPLE_OBJECTS
 * delete multiple objects
 *
 */
function delete_multiple_objects_by_prefix(req) {
    dbg.log0('delete_multiple_objects_by_prefix (lifecycle): prefix =', req.params.prefix);

    load_bucket(req);
    // TODO: change it to perform changes in one transaction. Won't scale.
    return list_objects(req)
        .then(items => {
            dbg.log0('objects by prefix', items.objects);
            if (items.objects.length > 0) {
                return P.all(_.map(items.objects, function(single_object) {
                    dbg.log0('single obj deleted:', single_object.key);
                    return P.fcall(() => {
                            var query = {
                                system: req.system._id,
                                bucket: req.bucket._id,
                                key: single_object.key
                            };
                            return md_store.ObjectMD.findOne(query).exec();
                        })
                        .then(obj => mongo_utils.check_entity_not_found(obj, 'object'))
                        .then(obj => delete_object_internal(obj));
                })).return();
            }
        })
        .return();
}


// /**
//  * return a regexp pattern to be appended to a prefix
//  * to make it match "prefix/file" or "prefix/dir/"
//  * but with a custom delimiter instead of /
//  * @param delimiter - a single character.
//  */
// function one_level_delimiter(delimiter) {
//     var d = string_utils.escapeRegExp(delimiter[0]);
//     return '[^' + d + ']*' + d + '?$';
// }
//
// /**
//  * common case is / as delimiter
//  */
// var ONE_LEVEL_SLASH_DELIMITER = one_level_delimiter('/');
//

// The method list_objects_s3 is used for s3 access exclusively
// Read: http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGET.html
// TODO: Currently we implement v1 of list-objects need to implement v2 as well
// There are two main ways to store objects inside folders:
// First way (mainly used by Cyberduck) - The objects are stored inside folders
// In this case Cyberduck will create an empty "object" (size 0) for each folder
// So to upload /tmp/object.mp4, Cyberduck will upload 0 sized object with key tmp/
// And afterwards upload an object with the key /tmp/object.mp4, which will have the content
// Second way - The objects are stored inside folders but we don't create the folders
// In this case we just upload the objects and write the folder hierarchy in it's key
// So to we just upload a file with key /tmp/object.mp4 and the list_objects will resolve it
function list_objects_s3(req) {
    dbg.log0('list_objects_s3', req.rpc_params);
    // Prefix mainly used as a folder name, in order to get all objects/prefixes inside that folder
    // Notice that the prefix can also be used as a searching tool among objects (not only folder)
    var prefix = req.rpc_params.prefix || '';
    // The delimiter is usually '/', this describes how we should handle the folder hierarchy
    var delimiter = req.rpc_params.delimiter || '';
    // Last object's key that was received from list-objects last call (when truncated)
    // This is used in order to continue from a certain key when the response is truncated
    var marker = prefix + (req.rpc_params.key_marker || '');
    var limit = req.rpc_params.limit || 1000;
    // ********* Important!!! *********
    // Notice that we add 1 to the limit.
    // This addition will be used in order to know if the response if truncated or not
    // Which means that we will always query 1 additional object/prefix and then cut it in response
    limit += 1;
    var results = [];
    var reply = {
        is_truncated: false,
        objects: [],
        common_prefixes: []
    };
    load_bucket(req);
    var done = false;
    return promise_utils.pwhile(
            function() {
                return !done;
            },
            function() {
                return P.fcall(() => {
                        return _list_next_objects(req, delimiter, prefix, marker, limit);
                    })
                    .then(res => {
                        results = _.concat(results, res);
                        // This is the case when there are no more objects that apply to the query
                        if (_.get(res, 'length', 0) === 0) {
                            // If there were no object/common prefixes to match then no next marker
                            reply.next_marker = marker;
                            done = true;
                        } else if (results.length >= limit) {
                            // This is the case when the number of objects that apply to the query
                            // Exceeds the number of objects that we've requested (max-keys)
                            // Thus we must cut the additional object (as mentioned above we request
                            // one more key in order to know if the response is truncated or not)
                            // In order to reply with the right amount of objects and prefixes
                            results = results.slice(0, limit - 1);
                            reply.is_truncated = true;
                            // Marking the object/prefix that we've stopped on
                            // Notice: THIS IS THE LAST OBJECT AFTER THE POP
                            reply.next_marker = results[results.length - 1].key;
                            done = true;
                        } else {
                            // In this case we did not reach the end yet
                            marker = res[res.length - 1].key;
                        }
                    });
            })
        .then(() => {
            // Fetching common prefixes and returning them in appropriate property
            reply.common_prefixes = _.compact(_.map(results, result => {
                if (!result.info) {
                    return result.key;
                }
            }));

            // Creating set of prefixes for an efficient look up
            let prefixes_set = new Set(reply.common_prefixes);
            // Filtering all of the prefixes and returning only objects
            reply.objects = _.filter(results, obj => !prefixes_set.has(obj.key));

            return reply;
        });
}

function _list_next_objects(req, delimiter, prefix, marker, limit) {
    // filter keys starting with prefix, *not* followed by marker
    var regexp_text = '^' + prefix;
    if (marker) {
        if (!marker.startsWith(prefix)) {
            throw new Error('BAD MARKER ' + marker + ' FOR PREFIX ' + prefix);
        }
        var marker_suffix = marker.slice(prefix.length);
        if (marker_suffix) {
            regexp_text += '(?!' + marker_suffix + ')';
        }
    }
    var regexp = new RegExp(regexp_text);

    return P.fcall(() => {
        let query = {
            system: req.system._id,
            bucket: req.bucket._id,
            key: {
                $regex: regexp,
                $gt: marker
            },
            deleted: null,
            upload_size: {
                $exists: req.rpc_params.upload_mode || false
            }
        };

        if (delimiter) {
            return md_store.ObjectMD.collection.mapReduce(
                    mongo_functions.map_common_prefixes_and_objects,
                    mongo_functions.reduce_common_prefixes_occurrence_and_objects, {
                        query: query,
                        sort: {
                            key: 1
                        },
                        limit: limit,
                        scope: {
                            prefix: prefix,
                            delimiter: delimiter,
                        },
                        out: {
                            inline: 1
                        }
                    })
                .then(res => {
                    return _.map(res, obj => {
                        if (_.isObject(obj.value)) {
                            let obj_value = get_object_info(obj.value);
                            return {
                                key: obj_value.key,
                                info: obj_value
                            };
                        } else {
                            return {
                                key: prefix + obj._id,
                            };
                        }
                    });
                });
        } else {
            var find = md_store.ObjectMD.find(query);
            if (limit) {
                find.limit(limit);
            }
            find.sort({
                key: 1
            });
            return find.lean().exec()
                .then(res => {
                    return _.map(res, obj => ({
                        key: obj.key,
                        info: get_object_info(obj)
                    }));
                });
        }
    });
}

function list_objects(req) {
    dbg.log0('list_objects', req.rpc_params);
    var prefix = req.rpc_params.prefix || '';
    let escaped_prefix = string_utils.escapeRegExp(prefix);
    load_bucket(req);
    return P.fcall(() => {
            var info = _.omit(object_md_query(req), 'key');
            if (prefix) {
                info.key = new RegExp('^' + escaped_prefix);
                if (req.rpc_params.create_time) {
                    let creation_date = moment.unix(req.rpc_params.create_time).toISOString();
                    info.create_time = {
                        $lt: new Date(creation_date)
                    };
                }
            } else if (req.rpc_params.key_query) {
                info.key = new RegExp(string_utils.escapeRegExp(req.rpc_params.key_query), 'i');
            } else if (req.rpc_params.key_regexp) {
                info.key = new RegExp(req.rpc_params.key_regexp);
            } else if (req.rpc_params.key_glob) {
                info.key = glob_to_regexp(req.rpc_params.key_glob);
            }

            // TODO: Should look at the upload_size or upload_completed?
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
                req.rpc_params.pagination && md_store.ObjectMD.count(info)
            );
        })
        .spread(function(objects, total_count) {
            let res = {};
            res.objects = _.map(objects, obj => ({
                key: obj.key,
                info: get_object_info(obj),
            }));

            if (req.rpc_params.pagination) {
                res.total_count = total_count;
            }
            return res;
        });
}

//mark all objects on specific bucket for sync
//TODO:: use mongoDB bulk instead of two mongoose ops
function set_all_files_for_sync(sysid, bucketid, should_resync_deleted_files) {
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
        .then(() => {
            if (should_resync_deleted_files) {
                return md_store.ObjectMD.update({
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
                }).exec();
            }
        });
}



function report_error_on_object(req) {
    // const bucket = req.rpc_params.bucket;
    // const key = req.rpc_params.key;
    // TODO should mark read errors on the object part & chunk?

    // report the blocks error to nodes monitor and allocator
    // so that next allocation attempts will use working nodes
    return nodes_client.instance().report_error_on_node_blocks(
        req.system._id, req.rpc_params.blocks_report);
}


function add_s3_usage_report(req) {
    return P.fcall(() => {
        return ObjectStats.create({
            system: req.system,
            s3_usage_info: req.rpc_params.s3_usage_info,
            s3_errors_info: req.rpc_params.s3_errors_info,
        });
    }).return();
}

function remove_s3_usage_reports(req) {
    var q = ObjectStats.remove();
    if (!_.isUndefined(req.rpc_params.till_time)) {
        // query backwards from given time
        req.rpc_params.till_time = new Date(req.rpc_params.till_time);
        q.where('time').lte(req.rpc_params.till_time);
    } else {
        throw new RpcError('NO TILL_TIME', 'Parameters do not have till_time: ' + req.rpc_params);
    }
    //q.limit(req.rpc_params.limit || 10);
    return P.resolve(q.exec())
        .catch(err => {
            throw new RpcError('COULD NOT DELETE REPORTS', 'Error Deleting Reports: ' + err);
        })
        .return();
}

function read_s3_usage_report(req) {
    var q = ObjectStats.find({
        deleted: null
    }).lean();
    if (req.rpc_params.from_time) {
        // query backwards from given time
        req.rpc_params.from_time = new Date(req.rpc_params.from_time);
        q.where('time').gt(req.rpc_params.from_time).sort('-time');
    } else {
        // query backward from last time
        q.sort('-time');
    }
    //q.limit(req.rpc_params.limit || 10);
    return P.resolve(q.exec())
        .then(reports => {
            reports = _.map(reports, report_item => {
                let report = _.pick(report_item, 'system', 's3_usage_info', 's3_errors_info');
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



// UTILS //////////////////////////////////////////////////////////


function get_object_info(md) {
    var info = _.pick(md, 'size', 'content_type', 'etag', 'xattr', 'key', 'cloud_synced');
    var bucket = system_store.data.get_by_id(md.bucket);

    info.bucket = bucket.name;
    info.version_id = String(md._id);
    info.size = info.size || 0;
    info.content_type = info.content_type || 'application/octet-stream';
    info.etag = info.etag || '';
    info.upload_started = md.upload_started && md.upload_started.getTime();
    info.create_time = md.create_time && md.create_time.getTime();
    if (_.isNumber(md.upload_size)) {
        info.upload_size = md.upload_size;
    }
    if (md.stats) {
        info.stats = _.pick(md.stats, 'reads');
        if (md.stats.last_read !== undefined) {
            info.stats.last_read = md.stats.last_read.getTime();
        }
        if (_.isUndefined(md.stats.reads)) {
            info.stats.reads = 0;
        }
    }
    return info;
}

function load_bucket(req) {
    var bucket = req.system.buckets_by_name[req.rpc_params.bucket];
    if (!bucket) {
        throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.bucket);
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
        .then(obj => mongo_utils.check_entity_not_deleted(obj, 'object'));
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
        return P.resolve(md_store.ObjectMD.findOne({
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
        throw new RpcError('NO_SUCH_UPLOAD',
            'No such upload id: ' + req.rpc_params.upload_id);
    }
    // TODO: Should look at the upload_size or create_time?
    if (!_.isNumber(obj.upload_size)) {
        throw new RpcError('NO_SUCH_UPLOAD',
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
            throw new RpcError('IF_MODIFIED_SINCE');
        }
    }
    if (conditions.if_unmodified_since) {
        if (!obj ||
            conditions.if_unmodified_since > obj._id.getTimestamp().getTime()) {
            throw new RpcError('IF_UNMODIFIED_SINCE');
        }
    }
    if (conditions.if_match_etag) {
        if (!(obj && http_utils.match_etag(conditions.if_match_etag, obj.etag))) {
            throw new RpcError('IF_MATCH_ETAG');
        }
    }
    if (conditions.if_none_match_etag) {
        if (obj && http_utils.match_etag(conditions.if_none_match_etag, obj.etag)) {
            throw new RpcError('IF_NONE_MATCH_ETAG');
        }
    }
}

function throw_if_maintenance(req) {
    if (req.system && system_server_utils.system_in_maintenance(req.system._id)) {
        throw new RpcError('SYSTEM_IN_MAINTENANCE',
            'Operation not supported during maintenance mode');
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
exports.report_error_on_object = report_error_on_object;
// read
exports.read_object_mappings = read_object_mappings;
exports.read_node_mappings = read_node_mappings;
// object meta-data
exports.read_object_md = read_object_md;
exports.update_object_md = update_object_md;
exports.delete_object = delete_object;
exports.delete_multiple_objects = delete_multiple_objects;
exports.delete_multiple_objects_by_prefix = delete_multiple_objects_by_prefix;
exports.list_objects = list_objects;
exports.list_objects_s3 = list_objects_s3;
// cloud sync related
exports.set_all_files_for_sync = set_all_files_for_sync;
