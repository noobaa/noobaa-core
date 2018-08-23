/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const os = require('os');
const url = require('url');
// const util = require('util');
const mime = require('mime');
const crypto = require('crypto');
const assert = require('assert');
const ip_module = require('ip');
const glob_to_regexp = require('glob-to-regexp');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('./md_store').MDStore;
const LRUCache = require('../../util/lru_cache');
const size_utils = require('../../util/size_utils');
const time_utils = require('../../util/time_utils');
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
const BucketStatsStore = require('../analytic_services/bucket_stats_store').BucketStatsStore;
const UsageReportStore = require('../analytic_services/usage_report_store').UsageReportStore;
const events_dispatcher = require('./events_dispatcher');
const IoStatsStore = require('../analytic_services/io_stats_store').IoStatsStore;

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

/**
 *
 * create_object_upload
 *
 */
async function create_object_upload(req) {
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

    const tier = await map_writer.select_tier_for_write(req.bucket, info);
    dbg.log0('JAJAJA tier', tier);
    await MDStore.instance().insert_object(info);
    object_md_cache.put_in_cache(String(info._id), info);

    return {
        obj_id: info._id,
        tier: tier._id,
        chunk_split_config: req.bucket.tiering.chunk_split_config,
        chunk_coder_config: tier.chunk_config.chunk_coder_config,
    };
}


const ZERO_SIZE_ETAG = crypto.createHash('md5').digest('hex');

/**
 *
 * complete_object_upload
 *
 */
async function complete_object_upload(req) {
    throw_if_maintenance(req);
    const set_updates = {};
    const unset_updates = {
        upload_size: 1,
        upload_started: 1,
    };
    const obj = await find_cached_object_upload(req);
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

    const map_res = req.rpc_params.multiparts ?
        await map_writer.complete_object_multiparts(obj, req.rpc_params.multiparts) :
        await map_writer.complete_object_parts(obj);

    if (req.rpc_params.size !== map_res.size) {
        if (req.rpc_params.size >= 0) {
            throw new RpcError('BAD_SIZE',
                `size on complete object (${
                            req.rpc_params.size
                        }) differs from parts (${
                            map_res.size
                        })`);
        }
    }
    set_updates.size = map_res.size;
    set_updates.num_parts = map_res.num_parts;
    if (req.rpc_params.etag) {
        set_updates.etag = req.rpc_params.etag;
    } else if (map_res.size === 0) {
        set_updates.etag = ZERO_SIZE_ETAG;
    } else if (map_res.multipart_etag) {
        set_updates.etag = map_res.multipart_etag;
    } else {
        set_updates.etag = Buffer.from(req.rpc_params.md5_b64, 'base64').toString('hex');
    }

    set_updates.create_time = new Date();
    set_updates.version_seq = await MDStore.instance().alloc_object_version_seq();
    if (req.bucket.versioning === 'ENABLED') {
        set_updates.version_enabled = true;
    }

    await _put_object_handle_latest({ req, put_obj: obj, set_updates, unset_updates });

    _dispatch_triggers(req.bucket, obj, 'ObjectCreated:Put', req.account._id, req.auth_token);

    const took_ms = set_updates.create_time.getTime() - obj._id.getTimestamp().getTime();
    const upload_duration = time_utils.format_time_duration(took_ms);
    const upload_size = size_utils.human_size(set_updates.size);
    const upload_speed = size_utils.human_size(set_updates.size / took_ms * 1000);
    Dispatcher.instance().activity({
        system: req.system._id,
        level: 'info',
        event: 'obj.uploaded',
        obj: obj._id,
        actor: req.account && req.account._id,
        desc: `${obj.key} was uploaded by ${req.account && req.account.email} into bucket ${req.bucket.name}.` +
            `\nUpload size: ${upload_size}.` +
            `\nUpload duration: ${upload_duration}.` +
            `\nUpload speed: ${upload_speed}/sec.`,
    });

    return {
        etag: set_updates.etag,
        version_id: MDStore.instance().get_object_version_id(set_updates),
    };
}

async function update_bucket_counters({ system, bucket_name, content_type, read_count, write_count }) {
    const bucket = system.buckets_by_name[bucket_name];
    if (!bucket) return;
    await BucketStatsStore.instance().update_bucket_counters({
        system: system._id,
        bucket: bucket._id,
        content_type,
        read_count,
        write_count,
    });
}



/**
 *
 * abort_object_upload
 *
 */
async function abort_object_upload(req) {
    //TODO: Maybe mark the ul as aborted so we won't continue to allocate parts
    //and only then delete. Thus not having currently allocated parts deleted,
    //while continuing to ul resulting in a partial file
    const obj = await find_object_upload(req);
    await MDStore.instance().delete_object_by_id(obj._id);
    await map_deleter.delete_object_mappings(obj);
}



/**
 *
 * ALLOCATE_OBJECT_PARTS
 *
 */
async function allocate_object_parts(req) {
    throw_if_maintenance(req);
    const obj = await find_cached_object_upload(req);
    const location_info = req.rpc_params.location_info;
    return map_writer.allocate_object_parts(req.bucket, obj, req.rpc_params.parts, location_info);
}


/**
 *
 * FINALIZE_OBJECT_PART
 *
 */
async function finalize_object_parts(req) {
    throw_if_maintenance(req);
    const obj = await find_cached_object_upload(req);
    return map_writer.finalize_object_parts(req.bucket, obj, req.rpc_params.parts);
}


/**
 *
 * create_multipart
 *
 */
async function create_multipart(req) {
    throw_if_maintenance(req);
    const multipart = _.pick(req.rpc_params, 'num', 'size', 'md5_b64', 'sha256_b64');
    const obj = await find_object_upload(req);
    multipart._id = MDStore.instance().make_md_id();
    multipart.system = req.system._id;
    multipart.bucket = req.bucket._id;
    multipart.obj = obj._id;
    multipart.uncommitted = true;
    const tier = await map_writer.select_tier_for_write(req.bucket, multipart.obj);
    await MDStore.instance().insert_multipart(multipart);
    return {
        multipart_id: multipart._id,
        tier: tier._id,
        chunk_split_config: req.bucket.tiering.chunk_split_config,
        chunk_coder_config: tier.chunk_config.chunk_coder_config,
    };
}

/**
 *
 * complete_multipart
 *
 */
async function complete_multipart(req) {
    throw_if_maintenance(req);
    const multipart_id = MDStore.instance().make_md_id(req.rpc_params.multipart_id);
    const set_updates = {};

    const obj = await find_object_upload(req);
    const multipart = await MDStore.instance().find_multipart_by_id(multipart_id);

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
    set_updates.create_time = new Date();

    await MDStore.instance().update_multipart_by_id(multipart_id, set_updates);

    return {
        etag: Buffer.from(req.rpc_params.md5_b64, 'base64').toString('hex'),
        create_time: set_updates.create_time.getTime(),
    };
}

/**
 *
 * list_multiparts
 *
 */
async function list_multiparts(req) {
    const num_gt = req.rpc_params.num_marker || 0;
    const limit = req.rpc_params.max || 1000;
    const obj = await find_object_upload(req);
    const multiparts = await MDStore.instance().find_completed_multiparts_of_object(obj._id, num_gt, limit);
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
            last_modified: multipart.create_time.getTime(),
        });
    }
    if (reply.multiparts.length > 0 && reply.multiparts.length >= limit) {
        reply.is_truncated = true;
        reply.next_num_marker = last_num;
    }
    return reply;
}


/**
 *
 * READ_OBJECT_MAPPINGS
 *
 */
async function read_object_mappings(req) {
    const { start, end, skip, limit, adminfo, location_info } = req.rpc_params;

    if (adminfo && req.role !== 'admin') {
        throw new RpcError('UNAUTHORIZED', 'read_object_mappings: role should be admin');
    }

    const obj = await find_object_md(req);
    const parts = await map_reader.read_object_mappings(obj, start, end, skip, limit, adminfo, location_info);
    const info = get_object_info(obj);

    // when called from admin console, we do not update the stats
    // so that viewing the mapping in the ui will not increase read count
    if (!adminfo) {
        const date_now = new Date();
        MDStore.instance().update_object_by_id(
            obj._id, { 'stats.last_read': date_now },
            undefined, { 'stats.reads': 1 }
        );
        MDStore.instance().update_chunks_by_ids(
            _.map(parts, part => part.chunk_id), { tier_lru: date_now }
        );
    }

    return {
        object_md: info,
        parts,
        total_parts: obj.num_parts || 0,
    };
}


/**
 *
 * READ_NODE_MAPPINGS
 *
 */
async function read_node_mappings(req) {
    return _read_node_mappings(req);
}


/**
 *
 * READ_HOST_MAPPINGS
 *
 */
async function read_host_mappings(req) {
    return _read_node_mappings(req, true);
}


async function _read_node_mappings(req, by_host) {
    const { name, skip, limit, adminfo } = req.rpc_params;

    if (adminfo && req.role !== 'admin') {
        throw new RpcError('UNAUTHORIZED', 'read_node_mappings: role should be admin');
    }

    const node_ids = await nodes_client.instance().get_node_ids_by_name(req.system._id, name, by_host);

    const [objects, total_count] = await P.join(
        map_reader.read_node_mappings(node_ids, skip, limit),
        adminfo && MDStore.instance().count_blocks_of_nodes(node_ids)
    );

    return adminfo ? { objects, total_count } : { objects };
}

/**
 *
 * READ_OBJECT_MD
 *
 */
async function read_object_md(req) {
    dbg.log0('read_object_md:', req.rpc_params);
    const { bucket, key, md_conditions, adminfo } = req.rpc_params;

    if (adminfo && req.role !== 'admin') {
        throw new RpcError('UNAUTHORIZED', 'read_object_md: role should be admin');
    }

    const obj = await find_object_md(req);
    check_md_conditions(req, md_conditions, obj);
    const info = get_object_info(obj);

    if (adminfo) {

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
            bucket,
            key,
            version_id: info.version_id
        });

        // count object capacity
        const MAX_SIZE_CAP_FOR_OBJECT_RAW_QUERY = 20 * 1024 * 1024 * 1024;
        if (info.size < MAX_SIZE_CAP_FOR_OBJECT_RAW_QUERY) {
            const parts = await map_reader.read_object_mappings(obj);
            info.capacity_size = 0;
            _.forEach(parts, part => _.forEach(part.chunk.frags, frag => _.forEach(frag.blocks, block => {
                info.capacity_size += block.block_md.size;
            })));
        }
    }

    return info;
}



/**
 *
 * UPDATE_OBJECT_MD
 *
 */
async function update_object_md(req) {
    dbg.log0('update object md', req.rpc_params);
    throw_if_maintenance(req);
    const set_updates = _.pick(req.rpc_params, 'content_type');
    if (req.rpc_params.xattr) {
        set_updates.xattr = _.mapKeys(req.rpc_params.xattr, (v, k) => k.replace(/\./g, '@'));
    }
    const obj = await find_object_md(req);
    await MDStore.instance().update_object_by_id(obj._id, set_updates);
}



/**
 *
 * DELETE_OBJECT
 *
 */
async function delete_object(req) {
    throw_if_maintenance(req);
    load_bucket(req);

    const { reply, obj } = req.rpc_params.version_id ?
        await _delete_object_version(req) :
        await _delete_object_only_key(req);

    if (obj) {
        Dispatcher.instance().activity({
            system: req.system._id,
            level: 'info',
            event: 'obj.deleted',
            obj: obj._id,
            actor: req.account && req.account._id,
            desc: `${obj.key} was deleted by ${req.account && req.account.email}`,
        });

        const event_name = 'ObjectRemoved:Delete';
        _dispatch_triggers(req.bucket, obj, event_name, req.account._id, req.auth_token);
    }

    return reply;
}

/**
 *
 * DELETE_MULTIPLE_OBJECTS
 *
 */
async function delete_multiple_objects(req) {
    dbg.log0('delete_multiple_objects: keys =', req.rpc_params.objects);
    throw_if_maintenance(req);
    load_bucket(req);
    // group objects by key to run different keys concurrently but same keys sequentially.
    // we keep indexes to the requested objects list to return the results in the same order.
    const objects = req.rpc_params.objects;
    const group_by_key = {};
    for (let i = 0; i < objects.length; ++i) {
        const obj = objects[i];
        let group = group_by_key[obj.key];
        if (!group) {
            group = [];
            group_by_key[obj.key] = group;
        }
        group.push(i);
    }
    const results = [];
    results.length = objects.length;
    await Promise.all(Object.keys(group_by_key).map(async key => {
        for (const index of group_by_key[key]) {
            const obj = objects[index];
            let res;
            try {
                res = await delete_object(
                    _.defaults({
                        rpc_params: {
                            bucket: req.bucket.name,
                            key: obj.key,
                            version_id: obj.version_id,
                        }
                    }, req)
                );
            } catch (err) {
                dbg.error('Multiple delete for obj', obj, 'failed with reason', err);
                // for now we mapped all errors to internal error
                res = {
                    err_code: 'InternalError',
                    err_message: err.message || 'InternalError'
                };
            }
            results[index] = res;
        }
    }));
    return results;
}

/**
 *
 * DELETE_MULTIPLE_OBJECTS
 *
 */
async function delete_multiple_objects_by_prefix(req) {
    dbg.log0('delete_multiple_objects_by_prefix (lifecycle): prefix =', req.params.prefix);
    load_bucket(req);
    const key = new RegExp('^' + _.escapeRegExp(req.rpc_params.prefix));
    // TODO: change it to perform changes in batch. Won't scale.
    const objects = await MDStore.instance().find_objects({
        bucket_id: req.bucket._id,
        key: key,
        max_create_time: req.rpc_params.create_time,
        // limit: ?,
    });
    dbg.log0('delete_multiple_objects_by_prefix:', _.map(objects, 'key'));
    await delete_multiple_objects(_.assign(req, {
        rpc_params: {
            bucket: req.bucket.name,
            objects: _.map(objects, obj => ({
                key: obj.key,
                version_id: MDStore.instance().get_object_version_id(obj.version_id, obj.version_enabled),
            }))
        }
    }));
}


// The method list_objects is used for s3 access exclusively
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
async function list_objects(req) {
    dbg.log0('list_objects', req.rpc_params);
    load_bucket(req);

    const limit = _list_limit(req.rpc_params.limit);
    if (!limit) return { is_truncated: false, objects: [], common_prefixes: [] };

    const state = {
        bucket_id: req.bucket._id,
        delimiter: req.rpc_params.delimiter || '',
        prefix: req.rpc_params.prefix || '',
        key_marker: req.rpc_params.key_marker ? ((req.rpc_params.prefix || '') + req.rpc_params.key_marker) : '',
        limit: limit + 1,
        user_limit: limit,
        objects: [],
        common_prefixes: [],
        is_truncated: false,
        done: false,
    };

    while (!state.done) {
        const results = await MDStore.instance().list_objects(state);
        _list_add_results(state, results);
    }

    return {
        objects: state.objects,
        common_prefixes: state.common_prefixes,
        is_truncated: state.is_truncated,
        next_marker: (state.is_truncated && state.key_marker) || undefined,
    };
}

async function list_object_versions(req) {
    dbg.log0('list_object_versions', req.rpc_params);
    load_bucket(req);

    const limit = _list_limit(req.rpc_params.limit);
    if (!limit) return { is_truncated: false, objects: [], common_prefixes: [] };

    const key_marker = req.rpc_params.key_marker ? ((req.rpc_params.prefix || '') + req.rpc_params.key_marker) : '';
    let version_seq_marker;
    if (key_marker && req.rpc_params.version_id_marker) {
        // in any case where the requested version_id_marker could not be resolved to a valid version_seq
        // we use a version_seq_marker=undefined which will inherently skip that key.
        if (req.rpc_params.version_id_marker === 'null') {
            const null_version = await MDStore.instance().find_object_null_version(req.bucket._id, key_marker);
            version_seq_marker = (null_version && null_version.version_seq) || undefined;
        } else {
            version_seq_marker = _parse_version_seq_from_version_id(req.rpc_params.version_id_marker);
        }
    }

    const state = {
        bucket_id: req.bucket._id,
        delimiter: req.rpc_params.delimiter || '',
        prefix: req.rpc_params.prefix || '',
        key_marker,
        version_seq_marker,
        limit: limit + 1,
        user_limit: limit,
        objects: [],
        common_prefixes: [],
        is_truncated: false,
        done: false,
    };

    while (!state.done) {
        const results = await MDStore.instance().list_object_versions(state);
        _list_add_results(state, results);
    }

    return {
        objects: state.objects,
        common_prefixes: state.common_prefixes,
        is_truncated: state.is_truncated,
        next_marker: (state.is_truncated && state.key_marker) || undefined,
        next_version_id_marker: (
            state.is_truncated &&
            state.version_seq_marker &&
            MDStore.instance().get_object_version_id({
                version_enabled: true,
                version_seq: state.version_seq_marker,
            })
        ) || undefined,
    };
}

async function list_uploads(req) {
    dbg.log0('list_uploads', req.rpc_params);
    load_bucket(req);

    const limit = _list_limit(req.rpc_params.limit);
    if (!limit) return { is_truncated: false, objects: [], common_prefixes: [] };

    const state = {
        bucket_id: req.bucket._id,
        delimiter: req.rpc_params.delimiter || '',
        prefix: req.rpc_params.prefix || '',
        key_marker: req.rpc_params.key_marker ? ((req.rpc_params.prefix || '') + req.rpc_params.key_marker) : '',
        upload_started_marker: req.rpc_params.key_marker && req.rpc_params.upload_id_marker ?
            MDStore.instance().make_md_id(req.rpc_params.upload_id_marker) : undefined,
        limit: limit + 1,
        user_limit: limit,
        objects: [],
        common_prefixes: [],
        is_truncated: false,
        done: false,
    };

    while (!state.done) {
        const results = await MDStore.instance().list_uploads(state);
        _list_add_results(state, results);
    }

    return {
        objects: state.objects,
        common_prefixes: state.common_prefixes,
        is_truncated: state.is_truncated,
        next_marker: (state.is_truncated && state.key_marker) || undefined,
        next_upload_id_marker: (state.is_truncated && String(state.upload_started_marker)) || undefined,
    };
}

function _list_limit(limit) {
    limit = _.isUndefined(limit) ? 1000 : limit;
    if (limit < 0) throw new Error('Limit must be a positive Integer');
    // In case that we've received max-keys 0, we should return an empty reply without is_truncated
    // This is used in order to follow aws spec and bevaiour
    return Math.min(limit, 1000);
}

function _list_add_results(state, results) {
    let count = state.objects.length + state.common_prefixes.length;
    assert(count <= state.user_limit);

    if (!results.length) {
        state.done = true;
        return;
    }

    let has_common_prefixes = false;
    for (const obj of results) {
        // We always fetch user_limit+1 results which allows us to detect truncated reply
        if (count >= state.user_limit) {
            state.is_truncated = true;
            state.done = true;
            return;
        }
        state.limit -= 1;
        count += 1;
        if (obj.common_prefix) {
            state.key_marker = obj.key;
            state.upload_started_marker = undefined;
            state.version_seq_marker = undefined;
            state.common_prefixes.push(obj.key);
            has_common_prefixes = true;
        } else {
            state.key_marker = obj.key;
            state.upload_started_marker = obj.upload_started;
            state.version_seq_marker = obj.version_seq;
            state.objects.push(get_object_info(obj));
        }
    }

    // this case avoids another last query when we got less results and no common prefixes
    // with common prefixes we cannot avoid the last query because the results might be
    // less than the requested limit although there are more results to fetch
    if (!has_common_prefixes && count >= state.user_limit) {
        state.done = true;
    }
}

async function list_objects_admin(req) {
    dbg.log0('list_objects_admin', req.rpc_params);
    load_bucket(req);

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
    if (sort === 'state') sort = 'upload_started';

    const res = await MDStore.instance().find_objects({
        bucket_id: req.bucket._id,
        key: key,
        upload_mode: req.rpc_params.upload_mode,
        latest_versions: req.rpc_params.latest_versions,
        filter_delete_markers: req.rpc_params.filter_delete_markers,
        max_create_time: req.rpc_params.create_time,
        limit: req.rpc_params.limit,
        skip: req.rpc_params.skip,
        sort,
        order: req.rpc_params.order,
        pagination: req.rpc_params.pagination
    });

    res.objects = _.map(res.objects, obj => {
        obj = get_object_info(obj);
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
            version_id: obj.version_id
        });
        return obj;
    });

    if (!res.objects.length) {
        if (key) {
            res.empty_reason = 'NO_MATCHING_KEYS';
        } else if (req.rpc_params.upload_mode) {
            const has_uploads = await MDStore.instance().has_any_uploads_for_bucket(req.bucket._id);
            if (has_uploads) {
                res.empty_reason = 'NO_RESULTS';
            } else {
                res.empty_reason = 'NO_UPLOADS';
            }
        } else {
            const has_objects = await MDStore.instance().has_any_objects_for_bucket(req.bucket._id, req.rpc_params.upload_mode);
            if (has_objects) {
                const has_latests = await MDStore.instance().has_any_latest_objects_for_bucket(req.bucket._id, req.rpc_params.upload_mode);
                if (has_latests) {
                    res.empty_reason = 'NO_RESULTS';
                } else {
                    res.empty_reason = 'NO_LATEST';
                }
            } else {
                res.empty_reason = 'NO_OBJECTS';
            }
        }
    }

    return res;
}


async function report_error_on_object(req) {
    // const bucket = req.rpc_params.bucket;
    // const key = req.rpc_params.key;
    // TODO should mark read errors on the object part & chunk?

    // report the blocks error to nodes monitor and allocator
    // so that next allocation attempts will use working nodes
    return nodes_client.instance().report_error_on_node_blocks(
        req.system._id, req.rpc_params.blocks_report);
}


async function add_endpoint_usage_report(req) {
    const start_time = new Date(req.rpc_params.start_time);
    const reports = req.rpc_params.bandwidth_usage_info.map(record => {
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

        // truncate start time to the start of current hour
        // set end_time to the end of the hour
        const HOUR = 60 * 60 * 1000;
        insert.start_time = Math.floor(start_time / HOUR) * HOUR;
        insert.end_time = insert.start_time + HOUR - 1;
        return insert;
    });
    await P.join(
        UsageReportStore.instance().update_usage(req.system, req.rpc_params.s3_usage_info, req.rpc_params.s3_errors_info),
        UsageReportStore.instance().insert_usage_reports(reports, { accumulate: true })
    );
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
        version_id: bucket.versioning === 'DISABLED' ? undefined : MDStore.instance().get_object_version_id(md),
        is_latest: !md.version_past,
        delete_marker: md.delete_marker,
        xattr: md.xattr && _.mapKeys(md.xattr, (v, k) => k.replace(/@/g, '.')),
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

async function find_object_md(req) {
    let obj;
    load_bucket(req);
    // requests can omit obj_id if the caller does not care about consistency of the object identity between calls
    // which is othersize
    if (req.rpc_params.obj_id) {
        const _id = get_obj_id(req, 'BAD_OBJECT_ID');
        obj = await MDStore.instance().find_object_by_id(_id);
    } else if (req.rpc_params.version_id) {
        if (req.rpc_params.version_id === 'null') {
            obj = await MDStore.instance().find_object_null_version(req.bucket._id, req.rpc_params.key);
        } else {
            const version_seq = _parse_version_seq_from_version_id(req.rpc_params.version_id);
            if (!version_seq) {
                throw new RpcError('BAD_OBJECT_VERSION_ID', `bad version id ${req.rpc_params.version_id}`);
            }
            obj = await MDStore.instance().find_object_by_version(req.bucket._id, req.rpc_params.key, version_seq);
        }
    } else {
        obj = await MDStore.instance().find_object_latest(req.bucket._id, req.rpc_params.key);
    }
    check_object_mode(req, obj, 'NO_SUCH_OBJECT');
    return obj;
}

async function find_object_upload(req) {
    load_bucket(req);
    const obj_id = get_obj_id(req, 'NO_SUCH_UPLOAD');
    const obj = await MDStore.instance().find_object_by_id(obj_id);
    check_object_mode(req, obj, 'NO_SUCH_UPLOAD');
    return obj;
}

async function find_cached_object_upload(req) {
    load_bucket(req);
    const obj_id = get_obj_id(req, 'NO_SUCH_UPLOAD');
    const obj = await object_md_cache.get_with_cache(String(obj_id));
    check_object_mode(req, obj, 'NO_SUCH_UPLOAD');
    return obj;
}

function get_obj_id(req, rpc_code) {
    if (!MDStore.instance().is_valid_md_id(req.rpc_params.obj_id)) {
        throw new RpcError(rpc_code, `invalid obj_id ${req.rpc_params.obj_id}`);
    }
    return MDStore.instance().make_md_id(req.rpc_params.obj_id);
}

function check_object_mode(req, obj, rpc_code) {
    if (!obj || obj.deleted || obj.delete_marker) {
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

function _dispatch_triggers(bucket, obj, event_name, actor, token) {
    const triggers_to_run = events_dispatcher.get_triggers_for_event(bucket, obj, event_name);
    if (!triggers_to_run) return;
    setTimeout(() => events_dispatcher.run_bucket_triggers(triggers_to_run, bucket, obj, actor, token), 1000);
}


function _parse_version_seq_from_version_id(version_str) {
    return (version_str.startsWith('nbver-') && Number(version_str.slice(6))) || undefined;
}

function _get_delete_obj_reply(deleted_obj, created_obj) {
    const reply = {};
    if (deleted_obj) {
        reply.deleted_version_id = MDStore.instance().get_object_version_id(deleted_obj);
        reply.deleted_delete_marker = deleted_obj.delete_marker;
    }
    if (created_obj) {
        reply.created_version_id = MDStore.instance().get_object_version_id(created_obj);
        reply.created_delete_marker = created_obj.delete_marker;
    }
    return reply;
}


async function _put_object_handle_latest({ req, put_obj, set_updates, unset_updates }) {
    const bucket_versioning = req.bucket.versioning;

    if (bucket_versioning === 'DISABLED') {
        const obj = await MDStore.instance().find_object_null_version(req.bucket._id, put_obj.key);
        if (obj) {
            check_md_conditions(req, req.rpc_params.md_conditions, obj);
            // 2, 3, 6, 7
            await MDStore.instance().complete_object_upload_latest_mark_remove_current_and_delete({
                unmark_obj: obj,
                put_obj: put_obj,
                set_updates,
                unset_updates,
            });
            map_deleter.delete_object_mappings(obj);
        } else {
            // 6
            await MDStore.instance().update_object_by_id(put_obj._id, set_updates, unset_updates);
        }
        return;
    }

    if (bucket_versioning === 'ENABLED') {
        const obj = await MDStore.instance().find_object_latest(req.bucket._id, put_obj.key);
        if (obj) {
            check_md_conditions(req, req.rpc_params.md_conditions, obj);
            // 3, 6
            await MDStore.instance().complete_object_upload_latest_mark_remove_current({
                unmark_obj: obj,
                put_obj,
                set_updates,
                unset_updates,
            });
        } else {
            // 6
            await MDStore.instance().update_object_by_id(put_obj._id, set_updates, unset_updates);
        }
        return;
    }

    if (bucket_versioning === 'SUSPENDED') {
        const obj = await MDStore.instance().find_object_null_version(req.bucket._id, put_obj.key);
        if (obj) {
            check_md_conditions(req, req.rpc_params.md_conditions, obj);
            // 2, 3, 6, 7
            if (obj.version_past) {
                const latest_obj = await MDStore.instance().find_object_latest(req.bucket._id, put_obj.key);
                if (latest_obj) {
                    check_md_conditions(req, req.rpc_params.md_conditions, latest_obj);
                    // 2, 3, 6, 7
                    await MDStore.instance().complete_object_upload_latest_mark_remove_current_and_delete({
                        delete_obj: obj,
                        unmark_obj: latest_obj,
                        put_obj,
                        set_updates,
                        unset_updates,
                    });
                    map_deleter.delete_object_mappings(obj);
                } else {
                    // 6
                    await MDStore.instance().update_object_by_id(put_obj._id, set_updates, unset_updates);
                }
            } else {
                await MDStore.instance().complete_object_upload_latest_mark_remove_current_and_delete({
                    unmark_obj: obj,
                    put_obj,
                    set_updates,
                    unset_updates,
                });
                map_deleter.delete_object_mappings(obj);
            }
        } else {
            const latest_obj = await MDStore.instance().find_object_latest(req.bucket._id, put_obj.key);
            if (latest_obj) {
                check_md_conditions(req, req.rpc_params.md_conditions, latest_obj);
                // 3, 6
                await MDStore.instance().complete_object_upload_latest_mark_remove_current({
                    unmark_obj: latest_obj,
                    put_obj,
                    set_updates,
                    unset_updates,
                });
            } else {
                // 6
                await MDStore.instance().update_object_by_id(put_obj._id, set_updates, unset_updates);
            }
        }
    }
}

async function _delete_object_version(req) {
    const { version_id } = req.rpc_params;
    const bucket_versioning = req.bucket.versioning;
    const version_seq = _parse_version_seq_from_version_id(version_id);
    if (version_id !== 'null' && !version_seq) {
        throw new RpcError('BAD_OBJECT_VERSION_ID', `bad version id ${version_id}`);
    }

    if (bucket_versioning === 'DISABLED') {
        const obj = version_id === 'null' && await MDStore.instance().find_object_null_version(req.bucket._id, req.rpc_params.key);
        if (!obj) return { reply: {} };
        if (obj.delete_marker) dbg.error('versioning disabled bucket null objects should not have delete_markers', obj);
        check_md_conditions(req, req.rpc_params.md_conditions, obj);
        // 2, 3, 8
        await MDStore.instance().remove_object_and_unset_latest(obj);
        await map_deleter.delete_object_mappings(obj);
        return { obj, reply: _get_delete_obj_reply(obj) };
    }

    if (bucket_versioning === 'ENABLED' || bucket_versioning === 'SUSPENDED') {
        const obj = version_id === 'null' ?
            await MDStore.instance().find_object_null_version(req.bucket._id, req.rpc_params.key) :
            await MDStore.instance().find_object_by_version(req.bucket._id, req.rpc_params.key, version_seq);
        if (!obj) return { reply: {} };
        check_md_conditions(req, req.rpc_params.md_conditions, obj);
        if (obj.version_past) {
            // 2, 8
            await MDStore.instance().delete_object_by_id(obj._id);
            await map_deleter.delete_object_mappings(obj);
            return { obj, reply: _get_delete_obj_reply(obj) };
        } else {
            // deleting latest
            // we need to find the previous and make it the new latest
            const prev_version = await MDStore.instance().find_object_prev_version(req.bucket._id, req.rpc_params.key);
            if (prev_version) {
                check_md_conditions(req, req.rpc_params.md_conditions, prev_version);
                // 2, 3, 4, 8
                await MDStore.instance().remove_object_move_latest(obj, prev_version);
                await map_deleter.delete_object_mappings(obj);
                return { obj, reply: _get_delete_obj_reply(obj) };
            } else {
                // 2, 3, 8
                await MDStore.instance().remove_object_and_unset_latest(obj);
                await map_deleter.delete_object_mappings(obj);
                return { obj, reply: _get_delete_obj_reply(obj) };
            }
        }
    }
}

async function _delete_object_only_key(req) {
    const bucket_versioning = req.bucket.versioning;

    if (bucket_versioning === 'DISABLED') {
        const obj = await MDStore.instance().find_object_latest(req.bucket._id, req.rpc_params.key);
        if (!obj) return { reply: {} };
        check_md_conditions(req, req.rpc_params.md_conditions, obj);
        if (obj.delete_marker) dbg.error('versioning disabled bucket null objects should not have delete_markers', obj);
        // 2, 3, 8
        await MDStore.instance().remove_object_and_unset_latest(obj);
        await map_deleter.delete_object_mappings(obj);
        return { obj, reply: _get_delete_obj_reply(obj) };
    }

    if (bucket_versioning === 'ENABLED') {
        const obj = await MDStore.instance().find_object_latest(req.bucket._id, req.rpc_params.key);
        if (obj) {
            check_md_conditions(req, req.rpc_params.md_conditions, obj);
            // 3, 5
            const delete_marker = await MDStore.instance().insert_object_delete_marker_move_latest(
                obj, /* version_enabled: */ true);
            return { obj, reply: _get_delete_obj_reply(null, delete_marker) };
        } else {
            // 5
            const delete_marker = await MDStore.instance().insert_object_delete_marker({
                bucket: req.bucket._id,
                system: req.system._id,
                key: req.rpc_params.key,
                version_enabled: true
            });
            return { reply: _get_delete_obj_reply(null, delete_marker) };
        }
    }

    if (bucket_versioning === 'SUSPENDED') {
        const obj = await MDStore.instance().find_object_null_version(req.bucket._id, req.rpc_params.key);
        if (obj) {
            check_md_conditions(req, req.rpc_params.md_conditions, obj);
            if (obj.version_past) {
                const latest_obj = await MDStore.instance().find_object_latest(req.bucket._id, req.rpc_params.key);
                if (latest_obj) {
                    check_md_conditions(req, req.rpc_params.md_conditions, latest_obj);
                    // 3, 5
                    const delete_marker = await MDStore.instance().insert_object_delete_marker_move_latest_with_delete(obj, latest_obj);
                    await map_deleter.delete_object_mappings(obj);
                    return { obj, reply: _get_delete_obj_reply(obj, delete_marker) };
                } else {
                    // TODO: Should not happen since it means that we do not have latest
                    throw new RpcError('NO_SUCH_OBJECT', 'No such object: ' + req.rpc_params.key);
                }
            } else {
                // 2, 3, 5
                const delete_marker = await MDStore.instance().insert_object_delete_marker_move_latest_with_delete(obj);
                await map_deleter.delete_object_mappings(obj);
                return { obj, reply: _get_delete_obj_reply(obj, delete_marker) };
            }
        } else {
            const latest_obj = await MDStore.instance().find_object_latest(req.bucket._id, req.rpc_params.key);
            if (latest_obj) {
                check_md_conditions(req, req.rpc_params.md_conditions, latest_obj);
                // 3, 5
                const delete_marker = await MDStore.instance().insert_object_delete_marker_move_latest(latest_obj);
                return { reply: _get_delete_obj_reply(null, delete_marker) };
            } else {
                // 5
                const delete_marker = await MDStore.instance().insert_object_delete_marker({
                    bucket: req.bucket._id,
                    system: req.system._id,
                    key: req.rpc_params.key,
                });
                return { reply: _get_delete_obj_reply(null, delete_marker) };
            }
        }
    }
}


async function update_endpoint_stats(req) {
    console.log(`update_endpoint_stats. namespace_stats =`, req.rpc_params.namespace_stats);
    const namespace_stats = req.rpc_params.namespace_stats || [];
    const bucket_counters = req.rpc_params.bucket_counters || [];
    await P.all([
        P.map(namespace_stats, stats => IoStatsStore.instance().update_namespace_resource_io_stats({
            system: req.system._id,
            namespace_resource_id: stats.namespace_resource_id,
            stats: stats.io_stats
        }), { concurrency: 10 }),
        P.map(bucket_counters, counter => update_bucket_counters({ ...counter, system: req.system }), { concurrency: 10 })
    ]);
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
exports.list_uploads = list_uploads;
exports.list_object_versions = list_object_versions;
exports.list_objects_admin = list_objects_admin;
// error handling
exports.report_error_on_object = report_error_on_object;
exports.report_endpoint_problems = report_endpoint_problems;
// stats
exports.read_endpoint_usage_report = read_endpoint_usage_report;
exports.add_endpoint_usage_report = add_endpoint_usage_report;
exports.remove_endpoint_usage_reports = remove_endpoint_usage_reports;
exports.check_quota = check_quota;
exports.update_endpoint_stats = update_endpoint_stats;
