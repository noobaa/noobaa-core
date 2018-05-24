/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const os = require('os');
const url = require('url');
// const util = require('util');
const mime = require('mime');
const crypto = require('crypto');
const ip_module = require('ip');
const glob_to_regexp = require('glob-to-regexp');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('./md_store').MDStore;
const LRUCache = require('../../util/lru_cache');
const size_utils = require('../../util/size_utils');
const { RpcError } = require('../../rpc');
const Dispatcher = require('../notifications/dispatcher');
const http_utils = require('../../util/http_utils');
const map_writer = require('./map_writer');
const map_reader = require('./map_reader');
const map_deleter = require('./map_deleter');
const cloud_utils = require('../../util/cloud_utils');
const system_utils = require('../utils/system_utils');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const promise_utils = require('../../util/promise_utils');
const UsageReportStore = require('../analytic_services/usage_report_store').UsageReportStore;
const events_dispatcher = require('./events_dispatcher');

/**
 *
 * create_object_upload
 *
 */
function create_object_upload(req) {
    dbg.log0('create_object_upload:', req.rpc_params);
    throw_if_maintenance(req);
    load_bucket(req);

    check_quota(req.bucket);

    const obj_id = MDStore.instance().make_md_id();
    var info = {
        _id: obj_id,
        system: req.system._id,
        bucket: req.bucket._id,
        key: req.rpc_params.key,
        content_type: req.rpc_params.content_type ||
            mime.getType(req.rpc_params.key) ||
            'application/octet-stream',
        cloud_synced: false,
        upload_started: obj_id,
        upload_size: 0,
    };
    if (req.rpc_params.size >= 0) info.size = req.rpc_params.size;
    if (req.rpc_params.md5_b64) info.md5_b64 = req.rpc_params.md5_b64;
    if (req.rpc_params.sha256_b64) info.sha256_b64 = req.rpc_params.sha256_b64;

    if (req.rpc_params.xattr) {
        // translating xattr names to valid mongo property names which do not allow dots
        // we use `@` since it is not a valid char in HTTP header names
        info.xattr = _.mapKeys(req.rpc_params.xattr, (v, k) => k.replace(/\./g, '@'));
    }

    let tier;
    return P.resolve()
        .then(() => map_writer.select_tier_for_write(req.bucket, info))
        .then(tier1 => {
            tier = tier1;
        })
        .then(() => MDStore.instance().insert_object(info))
        .then(() => ({
            obj_id: info._id,
            chunk_split_config: req.bucket.tiering.chunk_split_config,
            chunk_coder_config: tier.chunk_config.chunk_coder_config,
        }));
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
                    throw new RpcError('BAD_DIGEST_MD5',
                        'md5 on complete object differs from create object', {
                            client: req.rpc_params.md5_b64,
                            server: obj.md5_b64,
                        });
                }
                set_updates.md5_b64 = req.rpc_params.md5_b64;
            }
            if (req.rpc_params.sha256_b64 !== obj.sha256_b64) {
                if (obj.sha256_b64) {
                    throw new RpcError('BAD_DIGEST_SHA256',
                        'sha256 on complete object differs from create object', {
                            client: req.rpc_params.sha256_b64,
                            server: obj.sha256_b64,
                        });
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
            if (req.rpc_params.etag) {
                set_updates.etag = req.rpc_params.etag;
            } else if (res.size === 0) {
                set_updates.etag = ZERO_SIZE_ETAG;
            } else if (res.multipart_etag) {
                set_updates.etag = res.multipart_etag;
            } else {
                set_updates.etag = Buffer.from(req.rpc_params.md5_b64, 'base64').toString('hex');
            }
        })
        .then(() => MDStore.instance().find_object_by_key(
            req.bucket._id,
            req.rpc_params.key,
            req.bucket.versioning === 'DISABLED' ? undefined : true
        ))
        .then(existing_obj => {
            // In case of versioning bucket we should not delete the existing object
            if (req.bucket.versioning === 'ENABLED') return;
            // check if the conditions for overwrite are met, throws if not
            check_md_conditions(req, req.rpc_params.md_conditions, existing_obj);
            // we passed the checks, so we can delete the existing object if exists
            return map_deleter.delete_object(existing_obj);
        })
        .then(() => {
            // setting create_time close to the mdstore update
            set_updates.create_time = new Date();
            set_updates.has_version = req.bucket.versioning === 'ENABLED';
            return MDStore.instance().update_object_by_id(obj._id, set_updates, unset_updates);
        })
        .then(() => {
            const event_name = 'ObjectCreated:Put';
            return dispatch_triggers(req.bucket, obj, event_name, req.account._id, req.auth_token);
        })
        .then(() => {
            Dispatcher.instance().activity({
                system: req.system._id,
                level: 'info',
                event: 'obj.uploaded',
                obj: obj._id,
                actor: req.account && req.account._id,
                desc: `${obj.key} was uploaded by ${req.account && req.account.email} into bucket ${req.bucket.name}`,
            });

            return {
                etag: set_updates.etag,
                version_id: req.bucket.versioning === 'ENABLED' ? obj._id : undefined
            };
        })
        .catch(err => {
            dbg.error('complete_object_upload: ERROR', err.stack || err);
            throw err;
        });
}

function update_bucket_write_counters(req) {
    const bucket = req.system.buckets_by_name[req.rpc_params.bucket];
    if (!bucket) {
        return;
    }
    system_store.make_changes_in_background({
        update: {
            buckets: [{
                _id: bucket._id,
                $inc: {
                    'stats.writes': 1
                },
                $set: {
                    'stats.last_write': new Date()
                }
            }]
        }
    });
}

function update_bucket_read_counters(req) {
    const bucket = req.system.buckets_by_name[req.rpc_params.bucket];
    if (!bucket) {
        return;
    }
    system_store.make_changes_in_background({
        update: {
            buckets: [{
                _id: bucket._id,
                $inc: {
                    'stats.reads': 1
                },
                $set: {
                    'stats.last_read': new Date()
                }
            }]
        }
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
        .then(obj => map_deleter.delete_object(obj))
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
        .then(obj => map_writer.allocate_object_parts(req.bucket, obj, req.rpc_params.parts));
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
    let tier;
    return find_object_upload(req)
        .then(obj => {
            multipart.system = req.system._id;
            multipart.bucket = req.bucket._id;
            multipart.obj = obj._id;
        })
        .then(() => map_writer.select_tier_for_write(req.bucket, multipart.obj))
        .then(tier1 => {
            tier = tier1;
        })
        .then(() => MDStore.instance().insert_multipart(multipart))
        .then(() => ({
            multipart_id: multipart._id,
            chunk_split_config: req.bucket.tiering.chunk_split_config,
            chunk_coder_config: tier.chunk_config.chunk_coder_config,
        }));
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
                    throw new RpcError('BAD_DIGEST_MD5',
                        'md5 on complete multipart differs from create multipart', {
                            client: req.rpc_params.md5_b64,
                            server: multipart.md5_b64,
                        });
                }
                set_updates.md5_b64 = req.rpc_params.md5_b64;
            }
            if (req.rpc_params.sha256_b64 !== multipart.sha256_b64) {
                if (multipart.sha256_b64) {
                    throw new RpcError('BAD_DIGEST_SHA256',
                        'sha256 on complete multipart differs from create multipart', {
                            client: req.rpc_params.sha256_b64,
                            server: multipart.sha256_b64,
                        });
                }
                set_updates.sha256_b64 = req.rpc_params.sha256_b64;
            }
            set_updates.num_parts = req.rpc_params.num_parts;
        })
        .then(() => {
            const event_name = 'ObjectCreated:CompleteMultipartUpload';
            return dispatch_triggers(req.bucket, obj, event_name, req.account._id, req.auth_token);
        })
        .then(() => MDStore.instance().update_multipart_by_id(multipart_id, set_updates))
        .then(() => ({
            etag: Buffer.from(req.rpc_params.md5_b64, 'base64').toString('hex'),
            create_time: multipart_id.getTimestamp().getTime(),
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
 * READ_OBJECT_MAPPINGS
 *
 */
function read_object_mappings(req) {
    var obj;
    var reply = {};

    const { start, end, skip, limit, adminfo } = req.rpc_params;
    if (adminfo && req.role !== 'admin') {
        throw new RpcError('UNAUTHORIZED', 'Only admin can get adminfo');
    }

    return find_object_md(req)
        .then(obj_arg => {
            obj = obj_arg;
            reply.object_md = get_object_info(obj);
            return map_reader.read_object_mappings(obj, start, end, skip, limit, adminfo);
        })
        .then(parts => {
            reply.parts = parts;
            reply.total_parts = obj.num_parts || 0;

            // when called from admin console, we do not update the stats
            // so that viewing the mapping in the ui will not increase read count
            if (!adminfo) {
                const date = new Date();
                MDStore.instance().update_object_by_id(
                    obj._id, { 'stats.last_read': date },
                    undefined, { 'stats.reads': 1 }
                );
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
    return _read_node_mappings(req);
}


/**
 *
 * READ_HOST_MAPPINGS
 *
 */
function read_host_mappings(req) {
    return _read_node_mappings(req, true);
}


function _read_node_mappings(req, by_host) {
    const { name, skip, limit, adminfo } = req.rpc_params;
    return nodes_client.instance().get_node_ids_by_name(req.system._id, name, by_host)
        .then(node_ids => P.join(
            map_reader.read_node_mappings(node_ids, skip, limit),
            adminfo && MDStore.instance().count_blocks_of_nodes(node_ids)
        ))
        .spread((objects, total_count) => (adminfo ? { objects, total_count } : { objects }));
}

/**
 *
 * READ_OBJECT_MD
 *
 */
function read_object_md(req) {
    dbg.log0('read_obj(1):', req.rpc_params);
    const system = req.system;
    const adminfo = req.rpc_params.adminfo;
    let info;
    return find_object_md(req)
        .then(obj => {
            check_md_conditions(req, req.params.md_conditions, obj);
            info = get_object_info(obj);
            if (!adminfo || req.role !== 'admin') return;

            // using the internal IP doesn't work when there is a different external ip
            // or when the intention is to use dns name.
            const endpoint =
                adminfo.signed_url_endpoint ||
                url.parse(system.base_address || '').hostname ||
                ip_module.address();
            const account_keys = req.account.access_keys[0];
            info.s3_signed_url = cloud_utils.get_signed_url({
                endpoint: endpoint,
                access_key: account_keys.access_key,
                secret_key: account_keys.secret_key,
                bucket: req.rpc_params.bucket,
                key: req.rpc_params.key,
            });

            const MAX_SIZE_CAP_FOR_OBJECT_RAW_QUERY = 20 * 1024 * 1024 * 1024;
            if (info.size < MAX_SIZE_CAP_FOR_OBJECT_RAW_QUERY) {
                return map_reader.read_object_mappings(obj)
                    .then(parts => {
                        info.capacity_size = 0;
                        _.forEach(parts, part => _.forEach(part.chunk.frags, frag => _.forEach(frag.blocks, block => {
                            info.capacity_size += block.block_md.size;
                        })));
                    });
            }
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
    const set_updates = _.pick(req.rpc_params, 'content_type');
    if (req.rpc_params.xattr) {
        set_updates.xattr = _.mapKeys(req.rpc_params.xattr, (v, k) => k.replace(/\./g, '@'));
    }
    return find_object_md(req)
        .then(obj => MDStore.instance().update_object_by_id(obj._id, set_updates))
        .return();
}



/**
 *
 * DELETE_OBJECT
 *
 */
async function delete_object(req) {
    load_bucket(req);
    const delete_version = req.rpc_params.version_id;
    const bucket_versioning = req.bucket.versioning;
    try {
        throw_if_maintenance(req);
        const obj = await find_object_md(req, true);
        check_md_conditions(req, req.rpc_params.md_conditions, obj);
        let info;

        // In case of versioning bucket we should not delete the existing object
        if (bucket_versioning === 'DISABLED') {
            await map_deleter.delete_object(obj);
        } else {
            if (!obj.has_version || delete_version !== undefined) {
                await map_deleter.delete_object(obj);
            }
            if (delete_version === undefined) info = await _create_delete_marker(obj);
        }

        Dispatcher.instance().activity({
            system: req.system._id,
            level: 'info',
            event: 'obj.deleted',
            obj: obj._id,
            actor: req.account && req.account._id,
            desc: `${obj.key} was deleted by ${req.account && req.account.email}`,
        });

        const event_name = 'ObjectRemoved:Delete';
        dispatch_triggers(req.bucket, obj, event_name, req.account._id, req.auth_token);
        let version_id = obj._id;
        if (info) {
            version_id = obj.has_version ? info._id : null;
        }
        const delete_marker = info ? info.delete_marker : obj.delete_marker;
        return {
            version_id,
            delete_marker
        };
    } catch (err) {
        dbg.error('delete_object failed with', err);
        if (err.rpc_code === 'NO_SUCH_OBJECT' && bucket_versioning !== 'DISABLED') {
            if (delete_version) return { version_id: delete_version };
            await _create_delete_marker({
                system: req.system._id,
                bucket: req.bucket._id,
                key: req.rpc_params.key,
                has_version: Boolean(bucket_versioning !== 'SUSPENDED')
            });
            return {
                version_id: null,
                delete_marker: true
            };
        }
        if (err.rpc_code !== 'NO_SUCH_OBJECT') throw err;
        return {};
    }
}

/**
 *
 * DELETE_MULTIPLE_OBJECTS
 *
 */
async function delete_multiple_objects(req) {
    dbg.log0('delete_multiple_objects: keys =', req.params.objects);
    throw_if_maintenance(req);
    load_bucket(req);
    const versioning_bucket_enabled = req.bucket.versioning === 'ENABLED';
    const versioning_bucket_disabled = req.bucket.versioning === 'DISABLED';
    let key_only_deletions;
    let version_only_deletions;
    const objects_with_version_id = await Promise.all(req.params.objects.filter(obj => obj.version_id !== undefined)
        .map(async obj => {
            if (obj.version_id === null) {
                const null_ver_obj = await MDStore.instance().find_object_by_key(req.bucket._id, obj.key, true);
                if (!null_ver_obj) {
                    return {
                        key: obj.key,
                        system: req.system._id,
                        bucket: req.bucket._id,
                        version_id: obj.version_id,
                        not_existing: true
                    };
                }
                return null_ver_obj;
            } else {
                const ver_obj = await MDStore.instance().find_object_by_id(MDStore.instance().make_md_id(obj.version_id));
                if (!ver_obj) {
                    return {
                        key: obj.key,
                        system: req.system._id,
                        bucket: req.bucket._id,
                        version_id: obj.version_id,
                        not_existing: true
                    };
                }
                return ver_obj;
            }
        })
    );
    const objects_with_key_only = await Promise.all(req.params.objects.filter(obj => obj.version_id === undefined)
        .map(async obj => {
            const res_obj = await MDStore.instance().find_object_by_key(
                req.bucket._id, obj.key,
                versioning_bucket_enabled ? undefined : true
            );
            if (!res_obj) return { key: obj.key, system: req.system._id, bucket: req.bucket._id, not_existing: true };
            return res_obj;
        }));

    // This part handles the deletion of keys only (version_id not supplied in deletion record)
    if (versioning_bucket_disabled) {
        const existing_objects = objects_with_key_only.filter(obj => !obj.not_existing);
        const non_existing_objects = objects_with_key_only.filter(obj => obj.not_existing);
        const deletion_results = await map_deleter.delete_multiple_objects(existing_objects);
        key_only_deletions = deletion_results.map(del_res => {
            if (del_res.reflect.isFulfilled()) {
                return compact({ key: del_res.obj.key });
            } else {
                return compact({
                    key: del_res.obj.key,
                    // TODO: Should map the AccessDenied as well
                    code: 'InternalError',
                    message: del_res.reflect.reason().message || 'UNKNOWN'
                });
            }
        });
        // Adding all of the non existing objects as success
        key_only_deletions = _.compact(_.concat(key_only_deletions, non_existing_objects.map(obj => compact({
            key: obj.key,
        }))));
    } else if (versioning_bucket_enabled) {
        key_only_deletions = await Promise.all(objects_with_key_only.map(async obj => {
            try {
                const delete_marker = await _create_delete_marker(obj);
                return {
                    key: obj.key,
                    delete_marker: true,
                    delete_marker_version_id: delete_marker._id.toString()
                };
            } catch (error) {
                return {
                    key: obj.key,
                    // TODO: Should map the AccessDenied as well
                    code: 'InternalError',
                    message: error.message || 'UNKNOWN'
                };
            }
        }));
    } else {
        // Means that we are in suspended
        // The existing should be null objects
        const existing_objects = objects_with_key_only.filter(obj => !obj.not_existing);
        const non_existing_objects = objects_with_key_only.filter(obj => obj.not_existing);
        const deletion_results = await map_deleter.delete_multiple_objects(existing_objects);
        key_only_deletions = deletion_results.map(async del_res => {
            try {
                if (del_res.reflect.isFulfilled()) {
                    // For null versions on delete without version_id we must create a marker in suspended
                    await _create_delete_marker(del_res.obj);
                    return compact({
                        key: del_res.obj.key,
                        delete_marker: true,
                        version_id: null
                    });
                } else {
                    throw new Error(`DELETE_FAILED`);
                }
            } catch (error) {
                return compact({
                    key: del_res.obj.key,
                    // TODO: Should map the AccessDenied as well
                    code: 'InternalError',
                    message: del_res.reflect.reason().message || 'UNKNOWN'
                });
            }
        });
        // Adding all of the non existing objects as success
        key_only_deletions = _.compact(_.concat(key_only_deletions, non_existing_objects.map(async obj => {
            try {
                // For non existing objects on delete we must create a marker in suspended
                await _create_delete_marker(obj);
                return compact({
                    key: obj.key,
                    delete_marker: true,
                    version_id: null
                });
            } catch (error) {
                return compact({
                    key: obj.key,
                    // TODO: Should map the AccessDenied as well
                    code: 'InternalError',
                    message: error.message || 'UNKNOWN'
                });
            }
        })));
    }

    const existing_objects = objects_with_version_id.filter(obj => !obj.not_existing);
    const non_existing_objects = objects_with_version_id.filter(obj => obj.not_existing);
    // This part handles the deletion of keys with version_id (version_id was supplied in deletion record)
    const deletion_results = await map_deleter.delete_multiple_objects(existing_objects);
    version_only_deletions = deletion_results.map(del_res => {
        if (del_res.reflect.isFulfilled()) {
            return compact({
                key: del_res.obj.key,
                version_id: del_res.obj._id.toString(),
                delete_marker: versioning_bucket_disabled ? undefined : del_res.obj.delete_marker,
                delete_marker_version_id: del_res.obj.delete_marker && !versioning_bucket_disabled ?
                    del_res.obj._id.toString() : undefined
            });
        } else {
            return compact({
                key: del_res.obj.key,
                version_id: del_res.obj._id.toString(),
                // TODO: Should map the AccessDenied as well
                code: 'InternalError',
                message: del_res.reflect.reason().message || 'UNKNOWN'
            });
        }
    });
    // Adding all of the non existing objects as success
    version_only_deletions = _.compact(_.concat(version_only_deletions, non_existing_objects.map(obj => compact({
        key: obj.key,
        version_id: obj.version_id
    }))));

    return _.compact(_.concat(key_only_deletions, version_only_deletions));
}

/**
 *
 * DELETE_MULTIPLE_OBJECTS
 *
 */
function delete_multiple_objects_by_prefix(req) {
    dbg.log0('delete_multiple_objects_by_prefix (lifecycle): prefix =', req.params.prefix);
    load_bucket(req);
    const key = new RegExp('^' + _.escapeRegExp(req.rpc_params.prefix));
    // TODO: change it to perform changes in batch. Won't scale.
    return MDStore.instance().find_objects({
            bucket_id: req.bucket._id,
            key: key,
            max_create_time: req.rpc_params.create_time,
            // limit: ?,
        })
        .then(objects => {
            dbg.log0('delete_multiple_objects_by_prefix:', _.map(objects, 'key'));
            return map_deleter.delete_multiple_objects(objects);
        })
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
    load_bucket(req);
    // Prefix mainly used as a folder name, in order to get all objects/prefixes inside that folder
    // Notice that the prefix can also be used as a searching tool among objects (not only folder)
    var prefix = req.rpc_params.prefix || '';
    // The delimiter is usually '/', this describes how we should handle the folder hierarchy
    var delimiter = req.rpc_params.delimiter || '';
    // Last object's key that was received from list-objects last call (when truncated)
    // This is used in order to continue from a certain key when the response is truncated
    var marker = req.rpc_params.key_marker ? (prefix + req.rpc_params.key_marker) : '';
    var version_id_marker = !_.isUndefined(req.rpc_params.key_marker) &&
        !_.isUndefined(req.rpc_params.version_id_marker) ?
        req.rpc_params.version_id_marker : undefined;
    const versioning = {
        bucket_activated: req.bucket.versioning !== 'DISABLED',
        list_versions: req.rpc_params.list_versions
    };
    const received_limit = _.isUndefined(req.rpc_params.limit) ? 1000 : req.rpc_params.limit;

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
    var done = false;
    return promise_utils.pwhile(
            () => !done,
            () => MDStore.instance().find_objects_by_prefix_and_delimiter({
                bucket_id: req.bucket._id,
                upload_mode: req.rpc_params.upload_mode,
                delimiter,
                prefix,
                marker,
                limit,
                version_id_marker,
                versioning
            })
            .then(res => {
                results = _.concat(results, res);
                // This is the case when there are no more objects that apply to the query
                if (!res || !res.length) {
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
                    const last = results[results.length - 1];
                    reply.next_marker = last.key;
                    reply.next_version_id_marker = (last.obj &&
                        String(last.obj._id)) || undefined;
                    done = true;
                } else {
                    // In this case we did not reach the end yet
                    const last = res[res.length - 1];
                    marker = last.key;
                    version_id_marker = (((versioning.bucket_activated && versioning.list_versions) || req.rpc_params.upload_mode) &&
                        last.obj && String(last.obj._id)) || undefined;
                }
            })
        )
        .then(() => {
            // This is done since the versioning requires a different sorting that other lists
            const sort_for_versioning_order = objects => _.orderBy(objects, ['key', 'create_time'], ['asc', 'desc']);
            console.log(results);
            // Fetching common prefixes and returning them in appropriate property
            reply.common_prefixes = _.map(_.filter(results, r => !r.obj), 'key');
            // Creating set of prefixes for an efficient look up
            const prefixes_set = new Set(reply.common_prefixes);
            // Filtering all of the prefixes and returning only objects
            reply.objects = _.map(_.filter(results, r => r.obj && !prefixes_set.has(r.key)), r => get_object_info(r.obj));
            if (versioning.list_versions) reply.objects = sort_for_versioning_order(reply.objects);
            return reply;
        });
}

function list_objects(req) {
    dbg.log0('list_objects', req.rpc_params);
    load_bucket(req);
    const versioning = {
        bucket_activated: req.bucket.versioning !== 'DISABLED',
        list_versions: req.rpc_params.list_versions
    };
    let key;
    if (req.rpc_params.prefix) {
        key = new RegExp('^' + _.escapeRegExp(req.rpc_params.prefix));
    } else if (req.rpc_params.key_query) {
        key = new RegExp(_.escapeRegExp(req.rpc_params.key_query), 'i');
    } else if (req.rpc_params.key_regexp) {
        key = new RegExp(req.rpc_params.key_regexp);
    } else if (req.rpc_params.key_glob) {
        key = glob_to_regexp(req.rpc_params.key_glob);
    }

    let sort = req.rpc_params.sort;
    if (req.rpc_params.sort === 'state') {
        sort = 'upload_started';
    }
    return MDStore.instance().find_objects({
            bucket_id: req.bucket._id,
            key: key,
            upload_mode: req.rpc_params.upload_mode,
            max_create_time: req.rpc_params.create_time,
            limit: req.rpc_params.limit,
            skip: req.rpc_params.skip,
            sort,
            order: req.rpc_params.order,
            pagination: req.rpc_params.pagination,
            versioning
        })
        .then(res => _wrap_objects_for_fe(res, req));
}

function _wrap_objects_for_fe(response, req) {
    return P.resolve()
        .then(() => P.map(response.objects, object => P.resolve(get_object_info(object))
            .then(obj => {
                // using the internal IP doesn't work when there is a different external ip
                // or when the intention is to use dns name.
                const endpoint =
                    (req.rpc_params.adminfo && req.rpc_params.adminfo.signed_url_endpoint) ||
                    url.parse(req.system.base_address || '').hostname ||
                    ip_module.address();
                const account_keys = req.account.access_keys[0];
                obj.s3_signed_url = cloud_utils.get_signed_url({
                    endpoint: endpoint,
                    access_key: account_keys.access_key,
                    secret_key: account_keys.secret_key,
                    bucket: req.rpc_params.bucket,
                    key: obj.key,
                });
                return obj;
            })))
        .then(objects => {
            response.objects = objects;
            return response;
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


function add_endpoint_usage_report(req) {
    const start_time = new Date(req.rpc_params.start_time);
    const end_time = new Date(req.rpc_params.end_time);
    const inserts = req.rpc_params.bandwidth_usage_info.map(record => {
        const insert = _.pick(record, ['read_bytes', 'write_bytes', 'read_count', 'write_count']);
        insert.system = req.system._id;

        if (record.bucket) {
            const bucket = req.system.buckets_by_name[record.bucket];
            if (bucket) insert.bucket = bucket._id;
        }

        if (record.access_key) {
            const account = system_store.data.accounts.find(acc => acc.access_keys &&
                acc.access_keys[0].access_key.toString() === record.access_key);
            if (account) insert.account = account._id;
        }

        insert.start_time = start_time;
        insert.end_time = end_time;

        return insert;
    });
    return P.join(UsageReportStore.instance().update_usage(req.system, req.rpc_params.s3_usage_info, req.rpc_params.s3_errors_info),
            UsageReportStore.instance().insert_usage_reports(inserts))
        .return();
}

function remove_endpoint_usage_reports(req) {
    return UsageReportStore.instance().reset_usage(req.system);
}

function read_endpoint_usage_report(req) {
    return UsageReportStore.instance().get_usage(req.system);
}

function report_endpoint_problems(req) {
    const HOUR_IN_MILI = 3600000;
    const params = req.rpc_params;
    const server_info = system_store.get_local_cluster_info();
    switch (params.problem) {
        case 'STRESS':
            return P.resolve()
                .then(() => {
                    if (params.node_id) {
                        return nodes_client.instance().read_node_by_id(req.system && req.system._id, params.node_id);
                    }
                })
                .then(node => {
                    const endpoint_name = node ? `node ${node.os_info.hostname}-${node.ip}` :
                        `server ${os.hostname()}-${server_info.owner_secret}`;
                    return Dispatcher.instance().alert(
                        'MAJOR',
                        req.system && req.system._id,
                        `Due to ${endpoint_name} high memory utilization,
                        the S3 service may suffer some slowdown. To increase service performance,
                        you can either increase the ${node ? "node's" : "server's"} resources or scale out S3 agents.`,
                        Dispatcher.rules.once_every(HOUR_IN_MILI)
                    );
                });
        default:
            dbg.error('got unknown problem from endpoint - ', params);
            break;
    }
}

// UTILS //////////////////////////////////////////////////////////


function get_object_info(md) {
    var bucket = system_store.data.get_by_id(md.bucket);
    return {
        obj_id: md._id,
        bucket: bucket.name,
        key: md.key,
        size: md.size || 0,
        etag: md.etag || '',
        md5_b64: md.md5_b64 || undefined,
        sha256_b64: md.sha256_b64 || undefined,
        content_type: md.content_type || 'application/octet-stream',
        create_time: md.create_time ? md.create_time.getTime() : md._id.getTimestamp().getTime(),
        upload_started: md.upload_started ? md.upload_started.getTimestamp().getTime() : undefined,
        upload_size: _.isNumber(md.upload_size) ? md.upload_size : undefined,
        num_parts: md.num_parts,
        delete_marker: md.delete_marker,
        is_latest: md.is_latest,
        has_version: md.has_version,
        xattr: md.xattr && _.mapKeys(md.xattr, (v, k) => k.replace(/@/g, '.')),
        cloud_synced: md.cloud_synced,
        stats: md.stats ? {
            reads: md.stats.reads || 0,
            last_read: (md.stats.last_read && md.stats.last_read.getTime()) || 0,
        } : {
            reads: 0,
            last_read: 0,
        },
    };
}

function load_bucket(req) {
    var bucket = req.system.buckets_by_name[req.rpc_params.bucket];
    if (!bucket) {
        throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.bucket);
    }
    req.check_s3_bucket_permission(bucket);
    req.bucket = bucket;
}

// short living cache for objects
// the purpose is to reduce hitting the DB many many times per second during upload/download.
const object_md_cache = new LRUCache({
    name: 'ObjectMDCache',
    max_usage: 1000,
    expiry_ms: 1000, // 1 second of blissful ignorance
    load: function(id_str) {
        console.log('ObjectMDCache: load', id_str);
        const obj_id = MDStore.instance().make_md_id(id_str);
        return MDStore.instance().find_object_by_id(obj_id);
    }
});

function find_object_md(req, delete_method) {
    return P.resolve()
        .then(() => {
            load_bucket(req);
            // requests can omit obj_id if the caller does not care about consistency of the object identity between calls
            // which is othersize
            if (req.rpc_params.obj_id || req.rpc_params.version_id !== undefined) {
                const _id = req.rpc_params.version_id === undefined ?
                    get_obj_id(req, 'BAD_OBJECT_ID') :
                    get_obj_version_id(req, 'BAD_OBJECT_VERSION_ID');
                // This is the case when we want to delete the null version of the object
                // In this case there should be a key as well
                if (_id === null) {
                    return MDStore.instance().find_object_by_key(req.bucket._id, req.rpc_params.key, true);
                } else {
                    return MDStore.instance().find_object_by_id(_id);
                }
            }
            if (delete_method && req.bucket.versioning !== 'ENABLED') {
                return MDStore.instance().find_object_by_key(req.bucket._id, req.rpc_params.key, true);
            } else {
                return MDStore.instance().find_object_by_key(req.bucket._id, req.rpc_params.key);
            }
        })
        .then(obj => check_object_mode(req, obj, 'NO_SUCH_OBJECT', delete_method));
}

function find_object_upload(req) {
    return P.resolve()
        .then(() => {
            load_bucket(req);
            const obj_id = get_obj_id(req, 'NO_SUCH_UPLOAD');
            return MDStore.instance().find_object_by_id(obj_id);
        })
        .then(obj => check_object_mode(req, obj, 'NO_SUCH_UPLOAD'));
}

function find_cached_object_upload(req) {
    return P.resolve()
        .then(() => {
            load_bucket(req);
            const obj_id = get_obj_id(req, 'NO_SUCH_UPLOAD');
            return object_md_cache.get_with_cache(String(obj_id));
        })
        .then(obj => check_object_mode(req, obj, 'NO_SUCH_UPLOAD'));
}

function get_obj_id(req, rpc_code) {
    if (!MDStore.instance().is_valid_md_id(req.rpc_params.obj_id)) {
        throw new RpcError(rpc_code, `invalid obj_id ${req.rpc_params.obj_id}`);
    }
    return MDStore.instance().make_md_id(req.rpc_params.obj_id);
}

function get_obj_version_id(req, rpc_code) {
    if (req.rpc_params.version_id === null) return null;
    if (!MDStore.instance().is_valid_md_id(req.rpc_params.version_id)) {
        throw new RpcError(rpc_code, `invalid obj_version_id ${req.rpc_params.version_id}`);
    }
    return MDStore.instance().make_md_id(req.rpc_params.version_id);
}

function check_object_mode(req, obj, rpc_code, allow_delete_marker) {
    if (!obj || obj.deleted || (!allow_delete_marker && obj.delete_marker)) {
        throw new RpcError(rpc_code,
            `No such object: obj_id ${req.rpc_params.obj_id} bucket ${req.rpc_params.bucket} key ${req.rpc_params.key}`);
    }
    if (String(req.system._id) !== String(obj.system)) {
        throw new RpcError(rpc_code,
            `No such object in system: obj_id ${req.rpc_params.obj_id} bucket ${req.rpc_params.bucket} key ${req.rpc_params.key}`);
    }
    if (String(req.bucket._id) !== String(obj.bucket)) {
        throw new RpcError(rpc_code,
            `No such object in bucket: obj_id ${req.rpc_params.obj_id} bucket ${req.rpc_params.bucket} key ${req.rpc_params.key}`);
    }
    if (req.rpc_params.key !== obj.key) {
        throw new RpcError(rpc_code,
            `No such object for key: ${obj.key} obj_id ${req.rpc_params.obj_id} bucket ${req.rpc_params.bucket} key ${req.rpc_params.key}`);
    }
    if (rpc_code === 'NO_SUCH_UPLOAD') {
        if (!obj.upload_started) {
            throw new RpcError(rpc_code,
                `Object not in upload mode: obj_id ${req.rpc_params.obj_id} bucket ${req.rpc_params.bucket} key ${req.rpc_params.key}`);
        }
    }
    return obj;
}

function check_md_conditions(req, conditions, obj) {
    if (!conditions) return;
    if (!conditions.if_match_etag &&
        !conditions.if_none_match_etag &&
        !conditions.if_modified_since &&
        !conditions.if_unmodified_since) return;

    const data = obj ? {
        etag: obj.etag,
        last_modified: obj.create_time ?
            obj.create_time.getTime() : obj._id.getTimestamp().getTime(),
    } : {
        etag: '',
        last_modified: 0,
    };

    // See http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectHEAD.html#req-header-consideration-1
    // See https://tools.ietf.org/html/rfc7232 (HTTP Conditional Requests)
    let matched = false;
    let unmatched = false;

    if (conditions.if_match_etag) {
        if (!(obj && http_utils.match_etag(conditions.if_match_etag, data.etag))) {
            throw new RpcError('IF_MATCH_ETAG', 'check_md_conditions failed', data);
        }
        matched = true;
    }
    if (conditions.if_none_match_etag) {
        if (obj && http_utils.match_etag(conditions.if_none_match_etag, data.etag)) {
            throw new RpcError('IF_NONE_MATCH_ETAG', 'check_md_conditions failed', data);
        }
        unmatched = true;
    }
    if (conditions.if_modified_since) {
        if (!unmatched && (!obj || conditions.if_modified_since > data.last_modified)) {
            throw new RpcError('IF_MODIFIED_SINCE', 'check_md_conditions failed', data);
        }
    }
    if (conditions.if_unmodified_since) {
        if (!matched && (!obj || conditions.if_unmodified_since < data.last_modified)) {
            throw new RpcError('IF_UNMODIFIED_SINCE', 'check_md_conditions failed', data);
        }
    }
}

function throw_if_maintenance(req) {
    if (req.system && system_utils.system_in_maintenance(req.system._id)) {
        throw new RpcError('SYSTEM_IN_MAINTENANCE',
            'Operation not supported during maintenance mode');
    }
}

function check_quota(bucket) {
    if (!bucket.quota) return;

    let used_percent = system_utils.get_bucket_quota_usage_percent(bucket, bucket.quota);

    if (used_percent >= 100) {
        const bucket_used = bucket.storage_stats && size_utils.json_to_bigint(bucket.storage_stats.objects_size);
        const message = `the bucket ${bucket.name} used storage(${
                size_utils.human_size(bucket_used)
            }) exceeds the bucket quota (${
                size_utils.human_size(bucket.quota.value)
            })`;
        Dispatcher.instance().alert('MAJOR',
            system_store.data.systems[0]._id,
            `Bucket ${bucket.name} exceeded its configured quota of ${
                    size_utils.human_size(bucket.quota.value)
                }, uploads to this bucket will be denied`,
            Dispatcher.rules.once_daily);
        dbg.error(message);
        throw new RpcError('FORBIDDEN', message);
    } else if (used_percent >= 90) {
        Dispatcher.instance().alert('INFO',
            system_store.data.systems[0]._id,
            `Bucket ${bucket.name} exceeded 90% of its configured quota of ${size_utils.human_size(bucket.quota.value)}`,
            Dispatcher.rules.once_daily);
    }
}

function dispatch_triggers(bucket, obj, event_name, actor, token) {
    const triggers_to_run = events_dispatcher.get_triggers_for_event(bucket, obj, event_name);
    if (!triggers_to_run) return;
    setTimeout(() => events_dispatcher.run_bucket_triggers(triggers_to_run, bucket, obj, actor, token), 1000);
}

async function _create_delete_marker(obj) {
    const info = {
        _id: MDStore.instance().make_md_id(),
        system: obj.system,
        bucket: obj.bucket,
        key: obj.key,
        content_type: obj.content_type ||
            mime.getType(obj.key) ||
            'application/octet-stream',
        delete_marker: true,
        has_version: obj.has_version,
        create_time: new Date()
    };
    await MDStore.instance().insert_object(info);
    return info;
}

function compact(obj) {
    return _.omitBy(obj, _.isUndefined);
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
// read
exports.read_object_mappings = read_object_mappings;
exports.read_node_mappings = read_node_mappings;
exports.read_host_mappings = read_host_mappings;
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
exports.report_endpoint_problems = report_endpoint_problems;
// stats
exports.read_endpoint_usage_report = read_endpoint_usage_report;
exports.add_endpoint_usage_report = add_endpoint_usage_report;
exports.remove_endpoint_usage_reports = remove_endpoint_usage_reports;
exports.check_quota = check_quota;
exports.update_bucket_read_counters = update_bucket_read_counters;
exports.update_bucket_write_counters = update_bucket_write_counters;
