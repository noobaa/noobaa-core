/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const url = require('url');
const mime = require('mime');
const crypto = require('crypto');
const ip_module = require('ip');
const glob_to_regexp = require('glob-to-regexp');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('./md_store').MDStore;
const LRUCache = require('../../util/lru_cache');
const RpcError = require('../../rpc/rpc_error');
const Dispatcher = require('../notifications/dispatcher');
const http_utils = require('../../util/http_utils');
const map_writer = require('./map_writer');
const map_reader = require('./map_reader');
const map_deleter = require('./map_deleter');
const mongo_utils = require('../../util/mongo_utils');
const cloud_utils = require('../../util/cloud_utils');
const ObjectStats = require('../analytic_services/object_stats');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const string_utils = require('../../util/string_utils');
const promise_utils = require('../../util/promise_utils');
const map_allocator = require('./map_allocator');
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
        _id: MDStore.instance().make_md_id(),
        system: req.system._id,
        bucket: req.bucket._id,
        key: req.rpc_params.key,
        content_type: req.rpc_params.content_type ||
            mime.lookup(req.rpc_params.key) ||
            'application/octet-stream',
        cloud_synced: false,
        upload_started: new Date(),
        upload_size: 0,
    };
    if (req.rpc_params.xattr) info.xattr = req.rpc_params.xattr;
    if (req.rpc_params.size >= 0) info.size = req.rpc_params.size;
    if (req.rpc_params.md5_b64) info.md5_b64 = req.rpc_params.md5_b64;
    if (req.rpc_params.sha256_b64 >= 0) info.sha256_b64 = req.rpc_params.sha256_b64;
    return MDStore.instance().find_object_by_key_allow_missing(req.bucket._id, req.rpc_params.key)
        .then(existing_obj => {
            // check if the conditions for overwrite are met, throws if not
            check_md_conditions(req, req.rpc_params.overwrite_if, existing_obj);
            // we passed the checks, so we can delete the existing object if exists
            return delete_object_internal(existing_obj);
        })
        .then(() => MDStore.instance().insert_object(info))
        .return({
            upload_id: String(info._id)
        });
}


const ZERO_SIZE_ETAG = crypto.createHash('md5').digest('hex');

/**
 *
 * complete_object_upload
 *
 */
function complete_object_upload(req) {
    var obj;
    const set_updates = {};
    const unset_updates = {
        upload_size: 1,
        upload_started: 1,
    };
    throw_if_maintenance(req);
    return find_object_upload(req)
        .then(obj_arg => {
            obj = obj_arg;
            if (req.rpc_params.size !== obj.size) {
                if (obj.size >= 0) {
                    throw new RpcError('BAD_SIZE',
                        `size on complete object (${
                            req.rpc_params.size
                        }) differs from create object (${
                            obj.size
                        })`);
                }
            }
            if (req.rpc_params.md5_b64 !== obj.md5_b64) {
                if (obj.md5_b64) {
                    throw new RpcError('BAD_DIGEST',
                        `md5 on complete object (${
                            req.rpc_params.md5_b64
                        }) differs from create object (${
                            obj.md5_b64
                        })`);
                }
                set_updates.md5_b64 = req.rpc_params.md5_b64;
            }
            if (req.rpc_params.sha256_b64 !== obj.sha256_b64) {
                if (obj.sha256_b64) {
                    throw new RpcError('BAD_DIGEST',
                        `sha256 on complete object (${
                            req.rpc_params.sha256_b64
                        }) differs from create object (${
                            obj.sha256_b64
                        })`);
                }
                set_updates.sha256_b64 = req.rpc_params.sha256_b64;
            }
        })
        .then(() => map_writer.complete_object_parts(obj, req.rpc_params.multiparts))
        .then(res => {
            if (req.rpc_params.size !== res.size) {
                if (req.rpc_params.size >= 0) {
                    throw new RpcError('BAD_SIZE',
                        `size on complete object (${
                            req.rpc_params.size
                        }) differs from parts (${
                            obj.size
                        })`);
                }
            }
            set_updates.size = res.size;
            set_updates.num_parts = res.num_parts;
            set_updates.etag = res.size === 0 ?
                ZERO_SIZE_ETAG :
                (res.multipart_etag || Buffer.from(req.rpc_params.md5_b64, 'base64').toString('hex'));
            set_updates.create_time = new Date();
        })
        .then(() => MDStore.instance().update_object_by_id(obj._id, set_updates, unset_updates))
        .then(() => {
            Dispatcher.instance().activity({
                system: req.system._id,
                level: 'info',
                event: 'obj.uploaded',
                obj: obj._id,
                actor: req.account && req.account._id,
                desc: `${obj.key} was uploaded by ${req.account && req.account.email}`,
            });
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
                etag: set_updates.etag
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
        .then(obj => map_writer.finalize_object_parts(req.bucket, obj, req.rpc_params.parts));
}


/**
 *
 * create_multipart
 *
 */
function create_multipart(req) {
    const multipart = _.pick(req.rpc_params, 'num', 'size', 'md5_b64', 'sha256_b64');
    multipart._id = MDStore.instance().make_md_id();
    return find_object_upload(req)
        .then(obj => {
            multipart.system = req.system._id;
            multipart.bucket = req.bucket._id;
            multipart.obj = obj._id;
        })
        .then(() => MDStore.instance().insert_multipart(multipart))
        .return({
            multipart_id: String(multipart._id)
        });
}

/**
 *
 * complete_multipart
 *
 */
function complete_multipart(req) {
    const multipart_id = MDStore.instance().make_md_id(req.rpc_params.multipart_id);
    const set_updates = {};
    let obj;
    return find_object_upload(req)
        .then(obj_arg => {
            obj = obj_arg;
        })
        .then(() => MDStore.instance().find_multipart_by_id(multipart_id))
        .then(multipart => {
            if (!_.isEqual(multipart.obj, obj._id)) throw new RpcError('NO_SUCH_MULTIPART', 'Object id mismatch');
            if (req.rpc_params.num !== multipart.num) throw new RpcError('NO_SUCH_MULTIPART', 'Multipart number mismatch');
            if (req.rpc_params.size !== multipart.size) {
                if (multipart.size >= 0) {
                    throw new RpcError('BAD_SIZE',
                        `size on complete multipart (${
                            req.rpc_params.size
                        }) differs from create multipart (${
                            multipart.size
                        })`);
                }
                set_updates.size = req.rpc_params.size;
            }
            if (req.rpc_params.md5_b64 !== multipart.md5_b64) {
                if (multipart.md5_b64) {
                    throw new RpcError('BAD_DIGEST',
                        `md5 on complete multipart (${
                            req.rpc_params.md5_b64
                        }) differs from create multipart (${
                            multipart.md5_b64
                        })`);
                }
                set_updates.md5_b64 = req.rpc_params.md5_b64;
            }
            if (req.rpc_params.sha256_b64 !== multipart.sha256_b64) {
                if (multipart.sha256_b64) {
                    throw new RpcError('BAD_DIGEST',
                        `sha256 on complete multipart (${
                            req.rpc_params.sha256_b64
                        }) differs from create multipart (${
                            multipart.sha256_b64
                        })`);
                }
                set_updates.sha256_b64 = req.rpc_params.sha256_b64;
            }
            set_updates.num_parts = req.rpc_params.num_parts;
        })
        .then(() => MDStore.instance().update_multipart_by_id(multipart_id, set_updates))
        .then(() => ({
            etag: Buffer.from(req.rpc_params.md5_b64, 'base64').toString('hex')
        }));
}

/**
 *
 * list_multiparts
 *
 */
function list_multiparts(req) {
    const num_gt = req.rpc_params.num_marker || 0;
    const limit = req.rpc_params.max || 1000;
    return find_object_upload(req)
        .then(obj => MDStore.instance().find_multiparts_of_object(obj._id, num_gt, limit))
        .then(multiparts => {
            const reply = {
                is_truncated: false,
                multiparts: [],
            };
            let last_num = 0;
            for (const multipart of multiparts) {
                if (last_num === multipart.num) continue;
                last_num = multipart.num;
                reply.multiparts.push({
                    num: multipart.num,
                    size: multipart.size,
                    etag: Buffer.from(multipart.md5_b64, 'base64').toString('hex'),
                    last_modified: multipart._id.getTimestamp().getTime(),
                });
            }
            if (reply.multiparts.length > 0 && reply.multiparts.length >= limit) {
                reply.is_truncated = true;
                reply.next_num_marker = last_num;
            }
            return reply;
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
            MDStore.instance().find_object_by_key_allow_missing(req.bucket._id, req.rpc_params.key),
            MDStore.instance().find_object_by_key(req.bucket._id, req.rpc_params.source_key)
        )
        .spread((existing_obj_arg, source_obj_arg) => {
            existing_obj = existing_obj_arg;
            source_obj = source_obj_arg;
            create_info = {
                _id: MDStore.instance().make_md_id(),
                system: req.system._id,
                bucket: req.bucket._id,
                key: req.rpc_params.key,
                size: source_obj.size,
                etag: source_obj.etag,
                content_type: req.rpc_params.content_type ||
                    source_obj.content_type ||
                    mime.lookup(req.rpc_params.key) ||
                    'application/octet-stream',
                cloud_synced: false,
                upload_size: 0,
                upload_started: new Date(),
            };
            if (source_obj.md5_b64) create_info.md5_b64 = source_obj.md5_b64;
            if (source_obj.sha256_b64) create_info.sha256_b64 = source_obj.sha256_b64;
            if (req.rpc_params.xattr_copy) {
                create_info.xattr = source_obj.xattr;
            } else if (req.rpc_params.xattr) {
                create_info.xattr = req.rpc_params.xattr;
            }
            // check if the conditions for overwrite are met, throws if not
            check_md_conditions(req, req.rpc_params.overwrite_if, existing_obj);
            check_md_conditions(req, req.rpc_params.source_if, source_obj);
            // we passed the checks, so we can delete the existing object if exists
            return delete_object_internal(existing_obj);
        })
        .then(() => MDStore.instance().insert_object(create_info))
        .then(() => MDStore.instance().copy_object_parts(source_obj, create_info))
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
            return MDStore.instance().update_object_by_id(create_info._id, {
                create_time: new Date()
            }, {
                upload_size: 1,
                upload_started: 1,
            });
        })
        .then(() => ({
            source_md: get_object_info(source_obj)
        }));
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
            reply.total_parts = obj.num_parts || 0;

            // when called from admin console, we do not update the stats
            // so that viewing the mapping in the ui will not increase read count
            if (req.rpc_params.adminfo) return;
            const date = new Date();
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
            MDStore.instance().update_object_by_id(obj._id, {
                'stats.last_read': date
            }, undefined, {
                'stats.reads': 1
            });
        })
        .return(reply);
}


/**
 *
 * READ_NODE_MAPPINGS
 *
 */
function read_node_mappings(req) {
    return nodes_client.instance().read_node_by_name(req.system._id, req.params.name)
        .then(node => {
            const node_id = mongo_utils.make_object_id(node._id);
            const params = _.pick(req.rpc_params, 'skip', 'limit');
            params.node_id = node_id;
            params.system = req.system;
            return P.join(
                map_reader.read_node_mappings(params),
                req.rpc_params.adminfo &&
                MDStore.instance().count_blocks_of_node(node_id));
        })
        .spread((objects, blocks_count) => (
            req.rpc_params.adminfo ? {
                objects: objects,
                total_count: blocks_count
            } : {
                objects: objects
            }
        ));
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
    const set_updates = _.pick(req.rpc_params, 'content_type', 'xattr');
    return find_object_md(req)
        .then(obj => MDStore.instance().update_object_by_id(obj._id, set_updates))
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
    let obj;
    return MDStore.instance().find_object_by_key_allow_missing(req.bucket._id, req.rpc_params.key)
        .then(obj_arg => {
            obj = obj_arg;
            return delete_object_internal(obj);
        })
        .then(() => {
            if (!obj) return;
            Dispatcher.instance().activity({
                system: req.system._id,
                level: 'info',
                event: 'obj.deleted',
                obj: obj._id,
                actor: req.account && req.account._id,
                desc: `${obj.key} was deleted by ${req.account && req.account.email}`,
            });
        })
        .return();
}


/**
 *
 * DELETE_MULTIPLE_OBJECTS
 *
 */
function delete_multiple_objects(req) {
    dbg.log2('delete_multiple_objects: keys =', req.params.keys);
    throw_if_maintenance(req);
    load_bucket(req);
    // TODO: change it to perform changes in batch
    // TODO: missing dispatch of activity log
    return P.map(req.params.keys, key =>
            MDStore.instance().find_object_by_key_allow_missing(req.bucket._id, key)
            .then(obj => delete_object_internal(obj))
        )
        .return();
}

/**
 *
 * DELETE_MULTIPLE_OBJECTS
 *
 */
function delete_multiple_objects_by_prefix(req) {
    dbg.log0('delete_multiple_objects_by_prefix (lifecycle): prefix =', req.params.prefix);
    load_bucket(req);
    // TODO: change it to perform changes in batch. Won't scale.
    return list_objects(req)
        .then(res => P.map(res.objects, obj => {
            dbg.log0('delete_multiple_objects_by_prefix:', obj.key);
            return delete_object_internal(obj);
        }))
        .return();
}


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
    var marker = req.rpc_params.key_marker ? (prefix + req.rpc_params.key_marker) : '';

    const received_limit = _.get(req, 'rpc_params.limit', 1000);

    if (received_limit < 0) {
        const new_err = new Error();
        new_err.message = 'Limit must be a positive Integer';
        throw new_err;
    }

    var limit = Math.min(received_limit, 1000);

    var results = [];
    var reply = {
        is_truncated: false,
        objects: [],
        common_prefixes: []
    };

    // In case that we've received max-keys 0, we should return an empty reply without is_truncated
    // This is used in order to follow aws spec and bevaiour
    if (!limit) {
        return P.resolve(reply);
    }

    // ********* Important!!! *********
    // Notice that we add 1 to the limit.
    // This addition will be used in order to know if the response if truncated or not
    // Which means that we will always query 1 additional object/prefix and then cut it in response
    limit += 1;
    load_bucket(req);
    var done = false;
    return promise_utils.pwhile(
            () => !done,
            () => MDStore.instance().find_objects_by_prefix_and_delimiter({
                bucket_id: req.bucket._id,
                upload_mode: req.rpc_params.upload_mode,
                delimiter,
                prefix,
                marker,
                limit
            })
            .then()
            .then(res => {
                res = _.map(res, r => (
                    r.obj ? {
                        key: r.key,
                        info: get_object_info(r.obj)
                    } : r
                ));
                results = _.concat(results, res);
                // This is the case when there are no more objects that apply to the query
                if (_.get(res, 'length', 0) === 0) {
                    // If there were no object/common prefixes to match then no next marker
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
            })
        )
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

function list_objects(req) {
    dbg.log0('list_objects', req.rpc_params);
    load_bucket(req);
    let key;
    if (req.rpc_params.prefix) {
        key = new RegExp('^' + string_utils.escapeRegExp(req.rpc_params.prefix));
    } else if (req.rpc_params.key_query) {
        key = new RegExp(string_utils.escapeRegExp(req.rpc_params.key_query), 'i');
    } else if (req.rpc_params.key_regexp) {
        key = new RegExp(req.rpc_params.key_regexp);
    } else if (req.rpc_params.key_glob) {
        key = glob_to_regexp(req.rpc_params.key_glob);
    }
    return MDStore.instance().find_objects({
            bucket_id: req.bucket._id,
            key: key,
            upload_mode: req.rpc_params.upload_mode,
            max_create_time: req.rpc_params.create_time,
            limit: req.rpc_params.limit,
            skip: req.rpc_params.skip,
            sort: req.rpc_params.sort,
            order: req.rpc_params.order,
            pagination: req.rpc_params.pagination,
        })
        .then(res => {
            res.objects = _.map(res.objects, obj => ({
                key: obj.key,
                info: get_object_info(obj),
            }));
            return res;
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
    info.stats = md.stats ? {
        reads: md.stats.reads || 0,
        last_read: (md.stats.last_read && md.stats.last_read.getTime()) || 0,
    } : {
        reads: 0,
        last_read: 0,
    };
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

function find_object_md(req) {
    load_bucket(req);
    return MDStore.instance().find_object_by_key(req.bucket._id, req.rpc_params.key)
        .then(obj => mongo_utils.check_entity_not_deleted(obj, 'object'));
}

function find_object_upload(req) {
    load_bucket(req);
    if (!MDStore.instance().is_valid_md_id(req.rpc_params.upload_id)) {
        throw new RpcError('NO_SUCH_UPLOAD', `invalid id ${req.rpc_params.upload_id}`);
    }
    const obj_id = MDStore.instance().make_md_id(req.rpc_params.upload_id);
    return MDStore.instance().find_object_by_id(obj_id)
        .then(obj => check_object_upload_mode(req, obj));
}

// short living cache for objects
// the purpose is to reduce hitting the DB many many times per second during upload/download.
const object_md_cache = new LRUCache({
    name: 'ObjectMDCache',
    max_usage: 1000,
    expiry_ms: 1000, // 1 second of blissfull ignorance
    load: function(id) {
        const obj_id = MDStore.instance().make_md_id(id);
        console.log('ObjectMDCache: load', obj_id);
        return MDStore.instance().find_object_by_id(obj_id);
    }
});

function find_cached_object_upload(req) {
    load_bucket(req);
    return P.resolve()
        .then(() => object_md_cache.get_with_cache(req.rpc_params.upload_id))
        .then(obj => check_object_upload_mode(req, obj));
}

function check_object_upload_mode(req, obj) {
    if (!obj || obj.deleted) {
        throw new RpcError('NO_SUCH_UPLOAD',
            'No such upload id: ' + req.rpc_params.upload_id);
    }
    if (String(req.system._id) !== String(obj.system)) {
        throw new RpcError('NO_SUCH_UPLOAD',
            'No such upload id in system: ' + req.rpc_params.upload_id);
    }
    if (String(req.bucket._id) !== String(obj.bucket)) {
        throw new RpcError('NO_SUCH_UPLOAD',
            'No such upload id in bucket: ' + req.rpc_params.upload_id);
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
    if (!obj) return;
    return MDStore.instance().update_object_by_id(obj._id, {
            deleted: new Date(),
            cloud_synced: false
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
exports.complete_object_upload = complete_object_upload;
exports.abort_object_upload = abort_object_upload;
// multipart
exports.create_multipart = create_multipart;
exports.complete_multipart = complete_multipart;
exports.list_multiparts = list_multiparts;
// allocation of parts chunks and blocks
exports.allocate_object_parts = allocate_object_parts;
exports.finalize_object_parts = finalize_object_parts;
// copy
exports.copy_object = copy_object;
// read
exports.read_object_mappings = read_object_mappings;
exports.read_node_mappings = read_node_mappings;
// object meta-data
exports.read_object_md = read_object_md;
exports.update_object_md = update_object_md;
// deletion
exports.delete_object = delete_object;
exports.delete_multiple_objects = delete_multiple_objects;
exports.delete_multiple_objects_by_prefix = delete_multiple_objects_by_prefix;
// listing
exports.list_objects = list_objects;
exports.list_objects_s3 = list_objects_s3;
// error handling
exports.report_error_on_object = report_error_on_object;
// stats
exports.read_s3_usage_report = read_s3_usage_report;
exports.add_s3_usage_report = add_s3_usage_report;
exports.remove_s3_usage_reports = remove_s3_usage_reports;
