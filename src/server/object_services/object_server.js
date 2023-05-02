/* Copyright (C) 2016 NooBaa */
/*eslint max-lines: ["error", 2200]*/
'use strict';

require('../../util/fips');

const _ = require('lodash');
const os = require('os');
const util = require('util');
const mime = require('mime');
const crypto = require('crypto');
const assert = require('assert');
const glob_to_regexp = require('glob-to-regexp');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const { MDStore, make_md_id } = require('./md_store');
const LRUCache = require('../../util/lru_cache');
const size_utils = require('../../util/size_utils');
const time_utils = require('../../util/time_utils');
const addr_utils = require('../../util/addr_utils');
const { RpcError } = require('../../rpc');
const Dispatcher = require('../notifications/dispatcher');
const http_utils = require('../../util/http_utils');
const map_server = require('./map_server');
const map_reader = require('./map_reader');
const map_deleter = require('./map_deleter');
const cloud_utils = require('../../util/cloud_utils');
const system_utils = require('../utils/system_utils');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const { BucketStatsStore } = require('../analytic_services/bucket_stats_store');
const { EndpointStatsStore } = require('../analytic_services/endpoint_stats_store');
const events_dispatcher = require('./events_dispatcher');
const { IoStatsStore } = require('../analytic_services/io_stats_store');
const { ChunkAPI } = require('../../sdk/map_api_types');
const config = require('../../../config');
const Quota = require('../system_services/objects/quota');

// short living cache for objects
// the purpose is to reduce hitting the DB many many times per second during upload/download.
const object_md_cache = new LRUCache({
    name: 'ObjectMDCache',
    max_usage: 1000,
    expiry_ms: 1000, // 1 second of blissful ignorance
    load: function(id_str) {
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
    dbg.log1('create_object_upload:', req.rpc_params);
    throw_if_maintenance(req);
    load_bucket(req);
    check_quota(req.bucket);

    const encryption = _get_encryption_for_object(req);
    const obj_id = MDStore.instance().make_md_id();
    var info = {
        _id: obj_id,
        system: req.system._id,
        bucket: req.bucket._id,
        key: req.rpc_params.key,
        content_type: req.rpc_params.content_type ||
            mime.getType(req.rpc_params.key) ||
            'application/octet-stream',
        tagging: req.rpc_params.tagging,
        encryption
    };

    if (req.rpc_params.complete_upload) {
        if (!req.rpc_params.size || req.rpc_params.size < 0) {
            throw new RpcError('INVALID_REQUEST', 'valid size must be provided when using complete_upload');
        }
        if (!req.rpc_params.etag) {
            throw new RpcError('INVALID_REQUEST', 'etag must be provided when using complete_upload');
        }
        if (!req.rpc_params.last_modified_time) {
            throw new RpcError('INVALID_REQUEST', 'last_modified_time must be provided when using complete_upload');
        }
        info.etag = req.rpc_params.etag;
        info.last_modified_time = new Date(req.rpc_params.last_modified_time);
    } else {
        info.upload_size = 0;
        info.upload_started = obj_id;
    }

    if (req.bucket.namespace && req.bucket.namespace.caching) {
        info.cache_last_valid_time = new Date();
    }

    const lock_settings = config.WORM_ENABLED ? calc_retention(req) : undefined;
    if (lock_settings) info.lock_settings = lock_settings;

    if (req.rpc_params.size >= 0) info.size = req.rpc_params.size;
    if (req.rpc_params.md5_b64) info.md5_b64 = req.rpc_params.md5_b64;
    if (req.rpc_params.sha256_b64) info.sha256_b64 = req.rpc_params.sha256_b64;

    if (req.rpc_params.xattr) {
        // translating xattr names to valid mongo property names which do not allow dots
        // we use `@` since it is not a valid char in HTTP header names
        info.xattr = _.mapKeys(req.rpc_params.xattr, (v, k) => k.replace(/\./g, '@'));
    }

    if (req.rpc_params.content_encoding) {
        info.content_encoding = req.rpc_params.content_encoding;
    }

    const tier = await map_server.select_tier_for_write(req.bucket);
    await MDStore.instance().insert_object(info);
    object_md_cache.put_in_cache(String(info._id), info);

    return {
        obj_id: info._id,
        bucket_id: req.bucket._id,
        tier_id: tier._id,
        chunk_split_config: req.bucket.tiering.chunk_split_config,
        chunk_coder_config: tier.chunk_config.chunk_coder_config,
        encryption,
        bucket_master_key_id: (req.bucket.master_key_id.disabled === false && req.bucket.master_key_id._id) || undefined,
    };
}

function _get_encryption_for_object(req) {
    const bucket_encryption = req.bucket.encryption;
    const requested_encryption = req.rpc_params.encryption;
    if (requested_encryption) return requested_encryption; // TODO: Should omit key => _.omit(requested_encryption, 'key_b64');
    if (bucket_encryption) return bucket_encryption;
}

/**
 *
 * put_object_tagging
 *
 */
async function put_object_tagging(req) {
    dbg.log1('put_object_tagging:', req.rpc_params);
    throw_if_maintenance(req);
    load_bucket(req);
    const obj = await find_object_md(req);
    const info = get_object_info(obj);

    await MDStore.instance().update_object_by_id(
        obj._id, { tagging: req.rpc_params.tagging }, undefined, undefined
    );

    return {
        version_id: info.version_id
    };
}

/**
 *
 * get_object_tagging
 *
 */
async function get_object_tagging(req) {
    dbg.log1('get_object_tagging:', req.rpc_params);
    load_bucket(req);

    const obj = await find_object_md(req);
    const info = get_object_info(obj);

    return {
        tagging: info.tagging,
        version_id: info.version_id
    };
}


/**
 *
 * delete_object_tagging
 *
 */
async function delete_object_tagging(req) {
    dbg.log1('delete_object_tagging:', req.rpc_params);
    throw_if_maintenance(req);
    load_bucket(req);

    const obj = await find_object_md(req);
    const info = get_object_info(obj);

    await MDStore.instance().update_object_by_id(
        obj._id, undefined, { 'tagging': 1 }, undefined
    );

    return {
        version_id: info.version_id,
    };
}

function calc_retention(req) {
    dbg.log1('calc_retention:', req.rpc_params);
    let obj_settings = req.rpc_params.lock_settings;

    if (!obj_settings) {
        const retention_conf = get_default_lock_config(req.bucket);
        if (!retention_conf) return;

        let today = new Date();
        const retain_until_date = retention_conf.days ? new Date(today.setDate(today.getDate() + retention_conf.days)) :
            new Date(today.setFullYear(today.getFullYear() + retention_conf.years));

        obj_settings = { retention: { mode: retention_conf.mode, retain_until_date } };

    } else if (obj_settings.retention && obj_settings.retention.retain_until_date) {
        obj_settings.retention.retain_until_date = new Date(obj_settings.retention.retain_until_date);
    }
    return obj_settings;
}

function get_default_lock_config(bucket) {
    dbg.log1('get_default_lock_config:', bucket.object_lock_configuration);
    const bucket_info = bucket.object_lock_configuration;
    if (bucket_info.object_lock_enabled !== 'Enabled') {
        return;
    }
    if (bucket_info.rule) return bucket_info.rule.default_retention;
}
/**
 *
 * get_object_legal_hold
 *
 */

async function get_object_legal_hold(req) {
    dbg.log1('get_object_legal_hold:', req.rpc_params);
    load_bucket(req);
    const obj = await find_object_md(req);
    const info = get_object_info(obj, { role: req.role });

    if (req.role !== 'admin') {
        throw new RpcError('UNAUTHORIZED');
    }
    if (!info.lock_settings || !info.lock_settings.legal_hold) {
        throw new RpcError('INVALID_REQUEST');
    }
    return {
        legal_hold: { status: info.lock_settings.legal_hold.status }
    };
}
/**
 *
 * put_object_legal_hold
 *
 */
async function put_object_legal_hold(req) {
    dbg.log1('put_object_legal_hold:', req.rpc_params);
    throw_if_maintenance(req);
    load_bucket(req);
    const obj = await find_object_md(req);
    const info = get_object_info(obj, { role: req.role });

    let retention;

    if (req.role !== 'admin') {
        throw new RpcError('UNAUTHORIZED');
    }
    if (req.bucket.object_lock_configuration.object_lock_enabled !== 'Enabled') {
        throw new RpcError('INVALID_REQUEST');
    }
    if (info.lock_settings && info.lock_settings.retention) {
        retention = {
            mode: info.lock_settings.retention.mode,
            retain_until_date: info.lock_settings.retention.retain_until_date,
        };
    }
    await MDStore.instance().update_object_by_id(
        obj._id, {
            lock_settings: {
                legal_hold: {
                    status: req.params.legal_hold.status
                },
                retention,
            }
        }, undefined, undefined
    );

}
/**
 *
 * get_object_retention
 *
 */
async function get_object_retention(req) {
    dbg.log1('get_object_retention:', req.rpc_params);
    load_bucket(req);
    const obj = await find_object_md(req);
    const info = get_object_info(obj, { role: req.role });

    if (req.role !== 'admin') {
        throw new RpcError('UNAUTHORIZED');
    }
    if (!req.bucket.object_lock_configuration || req.bucket.object_lock_configuration.object_lock_enabled !== 'Enabled') throw new RpcError('INVALID_REQUEST');
    if (!info.lock_settings || !info.lock_settings.retention) throw new RpcError('NO_SUCH_OBJECT_LOCK_CONFIGURATION');

    return {
        retention: {
            retain_until_date: info.lock_settings.retention.retain_until_date,
            mode: info.lock_settings.retention.mode
        }
    };
}
/**
 *
 * put_object_retention
 *
 */
async function put_object_retention(req) {
    dbg.log1('put_object_retention:', req.rpc_params);

    throw_if_maintenance(req);
    load_bucket(req);
    const obj = await find_object_md(req);
    const info = get_object_info(obj, { role: req.role });

    if (req.role !== 'admin') {
        throw new RpcError('UNAUTHORIZED');
    }
    if (req.bucket.object_lock_configuration.object_lock_enabled !== 'Enabled') {
        throw new RpcError('INVALID_REQUEST');
    }
    if (info.lock_settings && info.lock_settings.retention &&
        (new Date(req.rpc_params.retention.retain_until_date) < new Date(info.lock_settings.retention.retain_until_date) ||
            !req.rpc_params.retention)) {

        if ((info.lock_settings.retention.mode === 'GOVERNANCE' && (!req.rpc_params.bypass_governance || req.role !== 'admin')) ||
            info.lock_settings.retention.mode === 'COMPLIANCE') {
            dbg.error('put object retention failed due object retention mode', obj);
            throw new RpcError('UNAUTHORIZED');
        }
    }
    let legal_hold;
    if (info.lock_settings && info.lock_settings.legal_hold) {
        legal_hold = { status: info.lock_settings.legal_hold.status };
    }
    await MDStore.instance().update_object_by_id(
        obj._id, {
            lock_settings: {
                retention: {
                    mode: req.rpc_params.retention.mode,
                    retain_until_date: req.rpc_params.retention.retain_until_date,
                },
                legal_hold,
            }
        }, undefined, undefined
    );
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
        await _complete_object_multiparts(obj, req.rpc_params.multiparts) :
        await _complete_object_parts(obj);

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
    if (req.bucket.namespace && req.bucket.namespace.caching) {
        set_updates.cache_last_valid_time = new Date();
    }
    set_updates.version_seq = await MDStore.instance().alloc_object_version_seq();
    if (req.bucket.versioning === 'ENABLED') {
        set_updates.version_enabled = true;
    }

    if (req.rpc_params.last_modified_time) {
        set_updates.last_modified_time = new Date(req.rpc_params.last_modified_time);
    }

    await _put_object_handle_latest({ req, put_obj: obj, set_updates, unset_updates });

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
        desc: `${obj.key} was uploaded by ${req.account && req.account.email.unwrap()} into bucket ${req.bucket.name.unwrap()}.` +
            `\nUpload size: ${upload_size}.` +
            `\nUpload duration: ${upload_duration}.` +
            `\nUpload speed: ${upload_speed}/sec.`,
    });
    return {
        etag: set_updates.etag,
        version_id: MDStore.instance().get_object_version_id(set_updates),
        encryption: obj.encryption,
        size: set_updates.size,
        content_type: obj.content_type,
    };
}


async function update_bucket_counters({ system, bucket_name, content_type, read_count, write_count }) {
    const bucket = system.buckets_by_name[bucket_name.unwrap()];
    if (!bucket || bucket.deleting) return;
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
}



/**
 *
 * create_multipart
 *
 */
async function create_multipart(req) {
    throw_if_maintenance(req);
    const obj = await find_object_upload(req);
    _check_encryption_permissions(obj.encryption, req.rpc_params.encryption);
    const tier = await map_server.select_tier_for_write(req.bucket);
    const multipart = {
        _id: MDStore.instance().make_md_id(),
        system: req.system._id,
        bucket: req.bucket._id,
        obj: obj._id,
        num: req.rpc_params.num,
        size: req.rpc_params.size,
        md5_b64: req.rpc_params.md5_b64,
        sha256_b64: req.rpc_params.sha256_b64,
        uncommitted: true,
    };

    await MDStore.instance().insert_multipart(multipart);
    return {
        multipart_id: multipart._id,
        bucket_id: req.bucket._id,
        tier_id: tier._id,
        chunk_split_config: req.bucket.tiering.chunk_split_config,
        chunk_coder_config: tier.chunk_config.chunk_coder_config,
        encryption: obj.encryption,
        bucket_master_key_id: (req.bucket.master_key_id.disabled === false && req.bucket.master_key_id._id) || undefined
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
        encryption: obj.encryption
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
 * GET_MAPPING
 *
 */
async function get_mapping(req) {
    throw_if_maintenance(req);
    const { chunks, move_to_tier, check_dups, location_info } = req.rpc_params;
    // TODO: const obj = await find_cached_object_upload(req);
    const get_map = new map_server.GetMapping({
        chunks: chunks.map(chunk_info => new ChunkAPI(chunk_info, system_store)),
        check_dups: Boolean(check_dups),
        move_to_tier: move_to_tier && system_store.data.get_by_id(move_to_tier),
        location_info,
    });
    const res_chunks = await get_map.run();
    return { chunks: res_chunks.map(chunk => chunk.to_api()) };
}


/**
 *
 * PUT_MAPPING
 *
 */
async function put_mapping(req) {
    throw_if_maintenance(req);
    // TODO: const obj = await find_cached_object_upload(req);
    const { chunks, move_to_tier } = req.rpc_params;
    const put_map = new map_server.PutMapping({
        chunks: chunks.map(chunk_info => new ChunkAPI(chunk_info, system_store)),
        move_to_tier: move_to_tier && system_store.data.get_by_id(move_to_tier),
    });
    await put_map.run();
}

/**
 *
 * copy_object_mapping
 *
 */
async function copy_object_mapping(req) {
    throw_if_maintenance(req);
    const [obj, source_obj, multipart] = await Promise.all([
        find_object_upload(req),
        MDStore.instance().find_object_by_id(MDStore.instance().make_md_id(req.rpc_params.copy_source.obj_id)),
        req.rpc_params.multipart_id && MDStore.instance().find_multipart_by_id(
            MDStore.instance().make_md_id(req.rpc_params.multipart_id)
        ),
    ]);
    const parts = await MDStore.instance().find_all_parts_of_object(source_obj);
    for (const part of parts) {
        part._id = MDStore.instance().make_md_id();
        part.obj = obj._id;
        part.bucket = req.bucket._id;
        part.multipart = multipart ? multipart._id : undefined;
        part.uncommitted = true;
    }
    await MDStore.instance().insert_parts(parts);
    return {
        object_md: get_object_info(source_obj),
        num_parts: parts.length,
    };
}

/**
 *
 * read_object_mapping
 *
 */
async function read_object_mapping(req) {
    const { start, end, location_info } = req.rpc_params;

    const obj = await find_object_md(req);
    const chunks = await map_reader.read_object_mapping(obj, start, end, location_info);
    const object_md = get_object_info(obj);

    // update the object read stats and the chunks hit date
    const date_now = new Date();
    MDStore.instance().update_object_by_id(
        obj._id, { 'stats.last_read': date_now },
        undefined, { 'stats.reads': 1 }
    );
    MDStore.instance().update_chunks_by_ids(
        chunks.map(chunk => chunk._id), { tier_lru: date_now }
    );

    return {
        object_md,
        chunks: chunks.map(chunk => chunk.to_api()),
    };
}


/**
 *
 * read_object_mapping_admin
 *
 */
async function read_object_mapping_admin(req) {
    const { skip, limit } = req.rpc_params;

    const obj = await find_object_md(req);
    const chunks = await map_reader.read_object_mapping_admin(obj, skip, limit);
    const object_md = get_object_info(obj);

    return {
        object_md,
        chunks: chunks.map(chunk => chunk.to_api(true)),
    };
}


/**
 *
 * READ_NODE_MAPPING
 *
 */
async function read_node_mapping(req) {
    const { name, skip, limit, by_host, adminfo } = req.rpc_params;

    if (adminfo && req.role !== 'admin') {
        throw new RpcError('UNAUTHORIZED', 'read_node_mapping: role should be admin');
    }

    const node_ids = await nodes_client.instance().get_node_ids_by_name(req.system._id, name, by_host);

    const [chunks, total_chunks] = await Promise.all([
        map_reader.read_node_mapping(node_ids, skip, limit),
        adminfo ? MDStore.instance().count_blocks_of_nodes(node_ids) : undefined,
    ]);

    const obj_ids = _.flatten(chunks.map(chunk => chunk.parts.map(part => part.obj_id)));
    const objects = await MDStore.instance().find_objects_by_id(obj_ids);

    return {
        chunks: chunks.map(chunk => chunk.to_api(true)),
        objects: objects.map(get_object_info),
        total_chunks,
    };
}

/**
 *
 * READ_OBJECT_MD
 *
 */
async function read_object_md(req) {
    dbg.log1('object_server.read_object_md:', req.rpc_params);
    const { bucket, key, md_conditions, adminfo, encryption } = req.rpc_params;

    if (adminfo && req.role !== 'admin') {
        throw new RpcError('UNAUTHORIZED', 'read_object_md: role should be admin');
    }

    const obj = await find_object_md(req);
    check_md_conditions(md_conditions, obj);
    const info = get_object_info(obj, { role: req.role });
    _check_encryption_permissions(obj.encryption, encryption);

    if (adminfo) {

        // using the internal IP doesn't work when there is a different external ip
        // or when the intention is to use dns name.
        const endpoint =
            adminfo.signed_url_endpoint ||
            addr_utils.get_base_address(req.system.system_address, { hint: 'EXTERNAL' }).hostname;

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
            const chunks = await map_reader.read_object_mapping_admin(obj);
            info.capacity_size = 0;
            for (const chunk of chunks) {
                for (const frag of chunk.frags) {
                    for (const block of frag.blocks) {
                        info.capacity_size += block.size;
                    }
                }
            }
        }
    }

    return info;
}


function _check_encryption_permissions(src_enc, req_enc) {
    if (!src_enc) return;
    // TODO: Perform a check on KMS/S3/Non Encrypted
    if (src_enc.key_md5_b64) {
        if (!req_enc) throw new RpcError('BAD_REQUEST', 'Bad Request');
        if (src_enc.algorithm !== req_enc.algorithm) throw new RpcError('BAD_REQUEST', 'Bad Request');
        const req_key_md5_b64 = req_enc.key_md5_b64 || crypto.createHash('md5').update(req_enc.key_b64).digest('base64');
        if (src_enc.key_md5_b64 !== req_key_md5_b64) throw new RpcError('BAD_REQUEST', 'Bad Request');
    }
}


/**
 *
 * UPDATE_OBJECT_MD
 *
 */
async function update_object_md(req) {
    dbg.log1('object_server.update object md', req.rpc_params);
    throw_if_maintenance(req);
    const set_updates = _.pick(req.rpc_params, 'content_type', 'xattr', 'cache_last_valid_time', 'last_modified_time');
    if (set_updates.xattr) {
        set_updates.xattr = _.mapKeys(set_updates.xattr, (v, k) => k.replace(/\./g, '@'));
    }
    if (set_updates.cache_last_valid_time) {
        set_updates.cache_last_valid_time = new Date(set_updates.cache_last_valid_time);
    }
    if (set_updates.last_modified_time) {
        set_updates.last_modified_time = new Date(set_updates.last_modified_time);
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
    load_bucket(req, { include_deleting: true });

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
            desc: `${obj.key} was deleted by ${req.account && req.account.email.unwrap()}`,
        });

    }

    return reply;
}

/**
 *
 * DELETE_MULTIPLE_OBJECTS
 *
 */
async function delete_multiple_objects(req) {
    dbg.log1('delete_multiple_objects: keys =', req.rpc_params.objects);
    throw_if_maintenance(req);
    load_bucket(req, { include_deleting: true });
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
async function delete_multiple_objects_by_filter(req) {
    load_bucket(req, { include_deleting: true });
    dbg.log1(`delete_multiple_objects_by_filter: bucket=${req.bucket.name} filter=${util.inspect(req.rpc_params)}`);
    const key = new RegExp('^' + _.escapeRegExp(req.rpc_params.prefix));
    const bucket_id = req.bucket._id;
    // TODO: change it to perform changes in batch. Won't scale.
    const query = {
        bucket_id,
        key,
        max_create_time: req.rpc_params.create_time,
        tagging: req.rpc_params.tags,
        filter_delete_markers: req.rpc_params.filter_delete_markers,
        max_size: req.rpc_params.size_less,
        min_size: req.rpc_params.size_greater,
        limit: req.rpc_params.limit,
    };

    const { objects } = await MDStore.instance().find_objects(query);

    await delete_multiple_objects(_.assign(req, {
        rpc_params: {
            bucket: req.bucket.name,
            objects: _.map(objects, obj => ({
                key: obj.key,
                version_id: MDStore.instance().get_object_version_id(obj),
            }))
        }
    }));
    const bucket_has_objects = await MDStore.instance().has_any_objects_for_bucket(bucket_id);
    return { is_empty: !bucket_has_objects };
}

/**
 * delete_multiple_objects_unordered is an internal function which
 * takes a number `limit` and a `bucket_id` and will delete the `limit`
 * objects from the bucket in NO PARTICULAR ORDER.
 * 
 * This function is inteded to use in the case of a bucket deletion
 * where we want to delete all the objects in the bucket but we don't
 * care about the order in which they are deleted or the versioning, etc.
 * @param {*} req 
 */
async function delete_multiple_objects_unordered(req) {
    load_bucket(req, { include_deleting: true });
    const bucket_id = req.bucket._id;
    const limit = req.rpc_params.limit;
    dbg.log0(`delete_multiple_objects_unordered: bucket=${req.bucket.name} limit=${limit}`);

    // find the objects - no need to paginate explicitly because
    // find_objects will ensure that it does not return any object
    // which is already marked for deletion and that's all we care
    // about here.
    const { objects } = await MDStore.instance().find_objects({
        bucket_id: make_md_id(bucket_id),
        limit,
        key: undefined,
    });

    // delete the objects
    await MDStore.instance().remove_objects_and_unset_latest(objects);

    const bucket_has_objects = await MDStore.instance().has_any_objects_for_bucket(bucket_id);
    return { is_empty: !bucket_has_objects };
}


// async function delete_all_objects(req) {
//     dbg.log1('delete_all_objects. limit =', req.params.limit);
//     load_bucket(req);
//     const { objects } = await MDStore.instance().find_objects({
//         bucket_id: req.bucket._id,
//         limit: req.rpc_params.limit,
//     });
//     dbg.log1('delete_all_objects:', _.map(objects, 'key'));
//     await delete_multiple_objects(_.assign(req, {
//         rpc_params: {
//             bucket: req.bucket.name,
//             objects: _.map(objects, obj => ({
//                 key: obj.key,
//                 version_id: MDStore.instance().get_object_version_id(obj),
//             }))
//         }
//     }));

// }



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
    dbg.log1('object_server.list_objects', req.rpc_params);
    load_bucket(req);

    const limit = _list_limit(req.rpc_params.limit);
    if (!limit) return { is_truncated: false, objects: [], common_prefixes: [] };

    const state = {
        bucket_id: req.bucket._id,
        delimiter: req.rpc_params.delimiter || '',
        prefix: req.rpc_params.prefix || '',
        key_marker: req.rpc_params.key_marker || '',
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
    dbg.log1('list_object_versions', req.rpc_params);
    load_bucket(req);

    const limit = _list_limit(req.rpc_params.limit);
    if (!limit) return { is_truncated: false, objects: [], common_prefixes: [] };

    const key_marker = req.rpc_params.key_marker || '';
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
    dbg.log1('list_uploads', req.rpc_params);
    load_bucket(req);

    const limit = _list_limit(req.rpc_params.limit);
    if (!limit) return { is_truncated: false, objects: [], common_prefixes: [] };

    const state = {
        bucket_id: req.bucket._id,
        delimiter: req.rpc_params.delimiter || '',
        prefix: req.rpc_params.prefix || '',
        key_marker: req.rpc_params.key_marker || '',
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
    // This is used in order to follow aws spec and behaviour
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
    dbg.log1('list_objects_admin', req.rpc_params);
    load_bucket(req);

    /** @type {RegExp} */
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

    const { objects, counters } = await MDStore.instance().find_objects({
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

    const objects_info = _.map(objects, obj => {
        const object_info = get_object_info(obj);
        // using the internal IP doesn't work when there is a different external ip
        // or when the intention is to use dns name.
        const { adminfo } = req.rpc_params;
        const endpoint =
            (adminfo && adminfo.signed_url_endpoint) ||
            addr_utils.get_base_address(req.system.system_address, { hint: 'EXTERNAL' }).hostname;

        const account_keys = req.account.access_keys[0];
        object_info.s3_signed_url = cloud_utils.get_signed_url({
            endpoint: endpoint,
            access_key: account_keys.access_key,
            secret_key: account_keys.secret_key,
            bucket: req.rpc_params.bucket,
            key: object_info.key,
            version_id: object_info.version_id
        });
        return object_info;
    });

    /** @type {string} */
    let empty_reason;
    if (!objects_info.length) {
        if (key) {
            empty_reason = 'NO_MATCHING_KEYS';
        } else if (req.rpc_params.upload_mode) {
            const has_uploads = await MDStore.instance().has_any_uploads_for_bucket(req.bucket._id);
            if (has_uploads) {
                empty_reason = 'NO_RESULTS';
            } else {
                empty_reason = 'NO_UPLOADS';
            }
        } else {
            const has_objects = await MDStore.instance().has_any_objects_for_bucket(req.bucket._id, req.rpc_params.upload_mode);
            if (has_objects) {
                const has_latests = await MDStore.instance().has_any_latest_objects_for_bucket(req.bucket._id, req.rpc_params.upload_mode);
                if (has_latests) {
                    empty_reason = 'NO_RESULTS';
                } else {
                    empty_reason = 'NO_LATEST';
                }
            } else {
                empty_reason = 'NO_OBJECTS';
            }
        }
    }

    return {
        objects: objects_info,
        counters,
        empty_reason,
    };
}


async function report_error_on_object(req) {
    const bucket = req.rpc_params.bucket;
    // const key = req.rpc_params.key;
    // TODO should mark read errors on the object part & chunk?

    // report the blocks error to nodes monitor and allocator
    // so that next allocation attempts will use working nodes
    return nodes_client.instance().report_error_on_node_blocks(
        req.system._id, req.rpc_params.blocks_report, bucket);
}

function reset_s3_ops_counters(req) {
    return EndpointStatsStore.instance.reset_s3_ops_counters(req.system);
}

function read_s3_ops_counters(req) {
    return EndpointStatsStore.instance.get_s3_ops_counters(req.system);
}

async function add_endpoint_report(req) {
    const params = req.rpc_params;
    const bandwidth = (params.bandwidth || []).map(record => {
        const account = system_store.data.accounts.find(acc => {
            const access_key = acc.access_keys &&
                acc.access_keys[0] &&
                acc.access_keys[0].access_key;
            return access_key && (access_key.unwrap() === record.access_key.unwrap());
        });
        const bucket = system_store.data.buckets.find(bkt =>
            bkt.name.unwrap() === record.bucket.unwrap()
        );
        return {
            bucket: bucket && bucket._id,
            account: account && account._id,
            read_bytes: record.read_bytes,
            write_bytes: record.write_bytes,
            read_count: record.read_count,
            write_count: record.write_count
        };
    });

    return EndpointStatsStore.instance.accept_endpoint_report(req.system, {
        timestamp: params.timestamp,
        endpoint_group: params.group_name,
        hostname: params.hostname,
        cpu: params.cpu,
        memory: params.memory,
        s3_ops: params.s3_ops,
        bandwidth
    });
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
                        `server ${os.hostname()}-${(server_info && server_info.owner_secret) || '?'}`;
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


/**
 * @param {nb.ObjectMD} md
 * @returns {nb.ObjectInfo}
 */
function get_object_info(md, options = {}) {
    var bucket = system_store.data.get_by_id(md.bucket);
    return {
        obj_id: md._id.toHexString(),
        bucket: bucket.name,
        key: md.key,
        size: md.size || 0,
        etag: md.etag || '',
        md5_b64: md.md5_b64 || undefined,
        sha256_b64: md.sha256_b64 || undefined,
        content_type: md.content_type || 'application/octet-stream',
        content_encoding: md.content_encoding,
        create_time: md.create_time ? md.create_time.getTime() : md._id.getTimestamp().getTime(),
        last_modified_time: md.last_modified_time ? (md.last_modified_time.getTime()) : undefined,
        cache_last_valid_time: md.cache_last_valid_time ? md.cache_last_valid_time.getTime() : undefined,
        upload_started: md.upload_started ? md.upload_started.getTimestamp().getTime() : undefined,
        upload_size: _.isNumber(md.upload_size) ? md.upload_size : undefined,
        num_parts: md.num_parts,
        version_id: bucket.versioning === 'DISABLED' ? undefined : MDStore.instance().get_object_version_id(md),
        lock_settings: config.WORM_ENABLED && options.role === 'admin' ? md.lock_settings : undefined,
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
        tagging: md.tagging,
        encryption: md.encryption,
        tag_count: (md.tagging && md.tagging.length) || 0,
    };
}

function load_bucket(req, { include_deleting } = {}) {
    var bucket = req.system.buckets_by_name && req.system.buckets_by_name[req.rpc_params.bucket.unwrap()];
    if (!bucket || (bucket.deleting && !include_deleting)) {
        throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.bucket);
    }
    req.check_s3_bucket_permission(bucket);
    req.bucket = bucket;
}

/**
 * @param {Object} req
 * @returns {Promise<nb.ObjectMD>}
 */
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

/**
 * @param {Object} req
 * @returns {Promise<nb.ObjectMD>}
 */
async function find_object_upload(req) {
    load_bucket(req);
    const obj_id = get_obj_id(req, 'NO_SUCH_UPLOAD');
    const obj = await MDStore.instance().find_object_by_id(obj_id);
    check_object_mode(req, obj, 'NO_SUCH_UPLOAD');
    return obj;
}

/**
 * @param {Object} req
 */
async function get_upload_object_range_info(req) {
    dbg.log1('object_server.get_upload_object_range_info:', req.rpc_params);
    throw_if_maintenance(req);

    const obj = await find_cached_partial_object_upload(req);
    const tier = await map_server.select_tier_for_write(req.bucket);
    const encryption = _get_encryption_for_object(req);

    return {
        obj_id: obj._id,
        bucket_id: req.bucket._id,
        upload_size: obj.upload_size,
        tier_id: tier._id,
        chunk_split_config: req.bucket.tiering.chunk_split_config,
        chunk_coder_config: tier.chunk_config.chunk_coder_config,
        encryption,
        bucket_master_key_id: (req.bucket.master_key_id.disabled === false && req.bucket.master_key_id._id) || undefined
    };
}

/**
 * @param {Object} req
 * @returns {Promise<nb.ObjectMD>}
 */
async function find_cached_object_upload(req) {
    load_bucket(req);
    const obj_id = get_obj_id(req, 'NO_SUCH_UPLOAD');
    const obj = await object_md_cache.get_with_cache(String(obj_id));
    check_object_mode(req, obj, 'NO_SUCH_UPLOAD');
    return obj;
}

/**
 * @param {Object} req
 * @returns {Promise<nb.ObjectMD>}
 */
async function find_cached_partial_object_upload(req) {
    load_bucket(req);
    // Use "NO_SUCH_OBJECT" for rpc error instead of "NO_SUCH_UPLOAD"
    // since partial object does not always have upload part
    const obj_id = get_obj_id(req, 'NO_SUCH_OBJECT');
    const obj = await object_md_cache.get_with_cache(String(obj_id));
    check_object_mode(req, obj, 'NO_SUCH_OBJECT');
    return obj;
}

function get_obj_id(req, rpc_code) {
    if (!MDStore.instance().is_valid_md_id(req.rpc_params.obj_id)) {
        throw new RpcError(rpc_code, `invalid obj_id ${req.rpc_params.obj_id}`);
    }
    return MDStore.instance().make_md_id(req.rpc_params.obj_id);
}

/**
 * @param {Object} req
 * @param {nb.ObjectMD} obj
 * @param {string} rpc_code
 */
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

function check_md_conditions(conditions, obj) {
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

    const quota = new Quota(bucket.quota);
    const alerts = [];
    const major_messages = [];
    quota.add_quota_alerts(system_store.data.systems[0]._id, bucket, alerts);
    for (const alert of alerts) {
        Dispatcher.instance().alert(alert.sev, alert.sysid, alert.alert, alert.rule);
        if (alert.sev === 'MAJOR') {
            major_messages.push(alert.alert);
        }
    }

    if (major_messages.length > 0) {
        const message = major_messages.join();
        dbg.error(message);
        throw new RpcError('INVALID_BUCKET_STATE', message);
    }
}

async function dispatch_triggers(req) {
    load_bucket(req);
    const triggers_to_run = events_dispatcher.get_triggers_for_event(req.bucket, req.rpc_params.obj, req.rpc_params.event_name);
    if (triggers_to_run.length === 0) return;
    setTimeout(() => events_dispatcher.run_bucket_triggers(
        triggers_to_run, req.bucket, req.rpc_params.obj, req.account._id, req.auth_token), 1000);
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
            check_md_conditions(req.rpc_params.md_conditions, obj);
            // 2, 3, 6, 7
            await MDStore.instance().complete_object_upload_latest_mark_remove_current_and_delete({
                unmark_obj: obj,
                put_obj: put_obj,
                set_updates,
                unset_updates,
            });
        } else {
            // 6
            await MDStore.instance().update_object_by_id(put_obj._id, set_updates, unset_updates);
        }
        return;
    }

    if (bucket_versioning === 'ENABLED') {
        const obj = await MDStore.instance().find_object_latest(req.bucket._id, put_obj.key);
        if (obj) {
            check_md_conditions(req.rpc_params.md_conditions, obj);
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
            check_md_conditions(req.rpc_params.md_conditions, obj);
            // 2, 3, 6, 7
            if (obj.version_past) {
                const latest_obj = await MDStore.instance().find_object_latest(req.bucket._id, put_obj.key);
                if (latest_obj) {
                    check_md_conditions(req.rpc_params.md_conditions, latest_obj);
                    // 2, 3, 6, 7
                    await MDStore.instance().complete_object_upload_latest_mark_remove_current_and_delete({
                        delete_obj: obj,
                        unmark_obj: latest_obj,
                        put_obj,
                        set_updates,
                        unset_updates,
                    });
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
            }
        } else {
            const latest_obj = await MDStore.instance().find_object_latest(req.bucket._id, put_obj.key);
            if (latest_obj) {
                check_md_conditions(req.rpc_params.md_conditions, latest_obj);
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
        const obj = version_id === 'null' && await MDStore.instance().find_object_or_upload_null_version(req.bucket._id, req.rpc_params.key);

        if (!obj) return { reply: {} };
        if (obj.delete_marker) dbg.error('versioning disabled bucket null objects should not have delete_markers', obj);
        check_md_conditions(req.rpc_params.md_conditions, obj);
        // 2, 3, 8
        await MDStore.instance().remove_object_and_unset_latest(obj);
        return { obj, reply: _get_delete_obj_reply(obj) };
    }

    if (bucket_versioning === 'ENABLED' || bucket_versioning === 'SUSPENDED') {
        const obj = version_id === 'null' ?
            await MDStore.instance().find_object_or_upload_null_version(req.bucket._id, req.rpc_params.key) :
            await MDStore.instance().find_object_by_version(req.bucket._id, req.rpc_params.key, version_seq);
        if (!obj) return { reply: {} };

        if (config.WORM_ENABLED && obj.lock_settings) {
            if (obj.lock_settings.legal_hold && obj.lock_settings.legal_hold.status === 'ON') {
                dbg.error('object is locked, can not delete object', obj);
                throw new RpcError('UNAUTHORIZED', 'can not delete locked object.');
            }
            if (obj.lock_settings.retention) {
                const now = new Date();
                const retain_until_date = new Date(obj.lock_settings.retention.retain_until_date);

                if (obj.lock_settings.retention.mode === 'COMPLIANCE' && retain_until_date > now) {
                    dbg.error('object is locked, can not delete object', obj);
                    throw new RpcError('UNAUTHORIZED', 'can not delete locked object.');
                }
                if (obj.lock_settings.retention.mode === 'GOVERNANCE' &&
                    (!req.rpc_params.bypass_governance || req.role !== 'admin') && retain_until_date > now) {
                    dbg.error('object is locked, can not delete object', obj);
                    throw new RpcError('UNAUTHORIZED', 'can not delete locked object.');
                }
            }
        }
        check_md_conditions(req.rpc_params.md_conditions, obj);
        if (obj.version_past) {
            // 2, 8
            await MDStore.instance().delete_object_by_id(obj._id);
            return { obj, reply: _get_delete_obj_reply(obj) };
        } else {
            // deleting latest
            // we need to find the previous and make it the new latest
            const prev_version = await MDStore.instance().find_object_prev_version(req.bucket._id, req.rpc_params.key);
            if (prev_version) {
                check_md_conditions(req.rpc_params.md_conditions, prev_version);
                // 2, 3, 4, 8
                await MDStore.instance().remove_object_move_latest(obj, prev_version);
                return { obj, reply: _get_delete_obj_reply(obj) };
            } else {
                // 2, 3, 8
                await MDStore.instance().remove_object_and_unset_latest(obj);
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
        check_md_conditions(req.rpc_params.md_conditions, obj);
        if (obj.delete_marker) dbg.error('versioning disabled bucket null objects should not have delete_markers', obj);
        // 2, 3, 8
        await MDStore.instance().remove_object_and_unset_latest(obj);
        return { obj, reply: _get_delete_obj_reply(obj) };
    }

    if (bucket_versioning === 'ENABLED') {
        const obj = await MDStore.instance().find_object_latest(req.bucket._id, req.rpc_params.key);
        if (obj) {
            check_md_conditions(req.rpc_params.md_conditions, obj);
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
            check_md_conditions(req.rpc_params.md_conditions, obj);
            if (obj.version_past) {
                const latest_obj = await MDStore.instance().find_object_latest(req.bucket._id, req.rpc_params.key);
                if (latest_obj) {
                    check_md_conditions(req.rpc_params.md_conditions, latest_obj);
                    // 3, 5
                    const delete_marker = await MDStore.instance().insert_object_delete_marker_move_latest_with_delete(obj, latest_obj);
                    return { obj, reply: _get_delete_obj_reply(obj, delete_marker) };
                } else {
                    // TODO: Should not happen since it means that we do not have latest
                    throw new RpcError('NO_SUCH_OBJECT', 'No such object: ' + req.rpc_params.key);
                }
            } else {
                // 2, 3, 5
                const delete_marker = await MDStore.instance().insert_object_delete_marker_move_latest_with_delete(obj);
                return { obj, reply: _get_delete_obj_reply(obj, delete_marker) };
            }
        } else {
            const latest_obj = await MDStore.instance().find_object_latest(req.bucket._id, req.rpc_params.key);
            if (latest_obj) {
                check_md_conditions(req.rpc_params.md_conditions, latest_obj);
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
        P.map_with_concurrency(5, namespace_stats, stats =>
            IoStatsStore.instance().update_namespace_resource_io_stats({
                system: req.system._id,
                namespace_resource_id: stats.namespace_resource_id,
                stats: stats.io_stats
            })
        ),
        P.map_with_concurrency(5, bucket_counters, counter =>
            update_bucket_counters({ ...counter, system: req.system })
        )
    ]);
}

/**
 * @param {nb.ObjectMD} obj
 */
async function _complete_object_parts(obj) {
    const context = {
        pos: 0,
        seq: 0,
        num_parts: 0,
        parts_updates: [],
    };

    const parts = await MDStore.instance().find_all_parts_of_object(obj);
    _complete_next_parts(parts, context);
    if (context.parts_updates.length) {
        await MDStore.instance().update_parts_in_bulk(context.parts_updates);
    }

    return {
        size: context.pos,
        num_parts: context.num_parts,
    };
}

/**
 * @param {nb.ObjectMD} obj
 * @param {Object} multipart_req
 */
async function _complete_object_multiparts(obj, multipart_req) {
    const context = {
        pos: 0,
        seq: 0,
        num_parts: 0,
        parts_updates: [],
    };

    const [multiparts, parts] = await Promise.all([
        MDStore.instance().find_all_multiparts_of_object(obj._id),
        MDStore.instance().find_all_parts_of_object(obj)
    ]);

    let next_part_num = 1;
    const md5 = crypto.createHash('md5');
    const parts_by_mp = _.groupBy(parts, 'multipart');
    const multiparts_by_num = _.groupBy(multiparts, 'num');
    const used_parts = [];
    const used_multiparts = [];

    for (const { num, etag } of multipart_req) {
        if (num !== next_part_num) {
            throw new RpcError('INVALID_PART',
                `multipart num=${num} etag=${etag} expected next_part_num=${next_part_num}`);
        }
        next_part_num += 1;
        const etag_md5_b64 = Buffer.from(etag, 'hex').toString('base64');
        const group = multiparts_by_num[num];
        group.sort(_sort_multiparts_by_create_time);
        const mp = group.find(it => Boolean(it.md5_b64 === etag_md5_b64 && it.create_time));
        if (!mp) {
            throw new RpcError('INVALID_PART',
                `multipart num=${num} etag=${etag} etag_md5_b64=${etag_md5_b64} not found in group ${util.inspect(group)}`);
        }
        md5.update(Buffer.from(mp.md5_b64, 'base64'));
        const mp_parts = parts_by_mp[mp._id.toHexString()] || [];
        _complete_next_parts(mp_parts, context);
        used_multiparts.push(mp);
        for (const part of mp_parts) {
            used_parts.push(part);
        }
    }

    const multipart_etag = md5.digest('hex') + '-' + (next_part_num - 1);
    const unused_parts = _.difference(parts, used_parts);
    const unused_multiparts = _.difference(multiparts, used_multiparts);
    const chunks_to_dereference = unused_parts.map(part => part.chunk);
    const used_multiparts_ids = used_multiparts.map(mp => mp._id);

    dbg.log1('_complete_object_multiparts:', obj, 'size', context.pos,
        'num_parts', context.num_parts, 'multipart_etag', multipart_etag);

    // for (const mp of unused_multiparts) dbg.log1('TODO GGG DELETE UNUSED MULTIPART', JSON.stringify(mp));
    // for (const part of unused_parts) dbg.log1('TODO GGG DELETE UNUSED PART', JSON.stringify(part));

    await Promise.all([
        context.parts_updates.length && MDStore.instance().update_parts_in_bulk(context.parts_updates),
        used_multiparts_ids.length && MDStore.instance().update_multiparts_by_ids(used_multiparts_ids, undefined, { uncommitted: 1 }),
        unused_parts.length && MDStore.instance().delete_parts(unused_parts),
        unused_multiparts.length && MDStore.instance().delete_multiparts(unused_multiparts),
        chunks_to_dereference.length && map_deleter.delete_chunks_if_unreferenced(chunks_to_dereference),
    ]);

    return {
        size: context.pos,
        num_parts: context.num_parts,
        multipart_etag,
    };
}


function _sort_multiparts_by_create_time(a, b) {
    if (!b.create_time) return 1;
    if (!a.create_time) return -1;
    return b.create_time - a.create_time;
}

function _complete_next_parts(parts, context) {
    parts.sort(_sort_parts_by_seq);
    const start_pos = context.pos;
    const start_seq = context.seq;
    for (const part of parts) {
        assert.strictEqual(part.start, context.pos - start_pos);
        assert.strictEqual(part.seq, context.seq - start_seq);
        const len = part.end - part.start;
        const updates = {
            _id: part._id,
            unset_updates: { uncommitted: 1 },
        };
        if (part.seq !== context.seq) {
            updates.set_updates = {
                seq: context.seq,
                start: context.pos,
                end: context.pos + len,
            };
        }
        context.parts_updates.push(updates);
        context.pos += len;
        context.seq += 1;
        context.num_parts += 1;
    }
}

function _sort_parts_by_seq(a, b) {
    return a.seq - b.seq;
}


// EXPORTS
// object upload
exports.create_object_upload = create_object_upload;
exports.complete_object_upload = complete_object_upload;
exports.abort_object_upload = abort_object_upload;
exports.get_upload_object_range_info = get_upload_object_range_info;
// multipart
exports.create_multipart = create_multipart;
exports.complete_multipart = complete_multipart;
exports.list_multiparts = list_multiparts;
// mapping
exports.get_mapping = get_mapping;
exports.put_mapping = put_mapping;
exports.copy_object_mapping = copy_object_mapping;
exports.read_object_mapping = read_object_mapping;
exports.read_object_mapping_admin = read_object_mapping_admin;
exports.read_node_mapping = read_node_mapping;
// object meta-data
exports.read_object_md = read_object_md;
exports.update_object_md = update_object_md;
// deletion
exports.delete_object = delete_object;
exports.delete_multiple_objects = delete_multiple_objects;
exports.delete_multiple_objects_by_filter = delete_multiple_objects_by_filter;
exports.delete_multiple_objects_unordered = delete_multiple_objects_unordered;
// listing
exports.list_objects = list_objects;
exports.list_uploads = list_uploads;
exports.list_object_versions = list_object_versions;
exports.list_objects_admin = list_objects_admin;
// error handling
exports.report_error_on_object = report_error_on_object;
exports.report_endpoint_problems = report_endpoint_problems;
// stats
exports.add_endpoint_report = add_endpoint_report;
exports.read_s3_ops_counters = read_s3_ops_counters;
exports.reset_s3_ops_counters = reset_s3_ops_counters;
exports.check_quota = check_quota;
exports.update_endpoint_stats = update_endpoint_stats;
exports.put_object_tagging = put_object_tagging;
exports.get_object_tagging = get_object_tagging;
exports.delete_object_tagging = delete_object_tagging;
exports.dispatch_triggers = dispatch_triggers;
// object lock
exports.put_object_legal_hold = put_object_legal_hold;
exports.get_object_legal_hold = get_object_legal_hold;
exports.put_object_retention = put_object_retention;
exports.get_object_retention = get_object_retention;
exports.calc_retention = calc_retention;
