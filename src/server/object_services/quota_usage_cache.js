/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const LRUCache = require('../../util/lru_cache');
const { RpcError } = require('../../rpc');
const Quota = require('../system_services/objects/quota');
const { MDStore } = require('./md_store');


const PG_BIGINT_MAX = '9223372036854775807';

/**
 * Object-server cache of quotausages.used_bytes / used_objects.
 *
 * create_object_upload and create_multipart admit through strict_quota.reserve,
 * which consults this cache instead of SELECTing quotausages on every request.
 * A local increment after admit lets the next upload on this server see pending
 * usage until the TTL refresh. Deletes and other releases invalidate the entry
 * so the next admit reloads the counter.
 *
 * The cache is process-local. It only works because these RPCs run in the
 * object server, not in the S3 endpoint.
 */
const quota_usage_cache = new LRUCache({
    name: 'QuotaUsageCache',
    expiry_ms: config.QUOTA_USAGE_CACHE_EXPIRY_MS,
    max_usage: config.QUOTA_USAGE_CACHE_MAX_ITEMS,
    /**
     * @param {{ scope_id: string }} params
     */
    make_key: params => String(params.scope_id),
    /**
     * @param {{ scope_id: string }} params
     */
    load: async params => {
        const usage = await MDStore.instance().get_usage(params.scope_id);
        return {
            used_bytes: Number(usage && usage.used_bytes) || 0,
            used_objects: Number(usage && usage.used_objects) || 0,
        };
    },
});


function is_strict_quota_bucket(bucket) {
    return Boolean(bucket && bucket.quota && bucket.quota.mode === 'strict');
}

function _limits_from_bucket(bucket) {
    const quota = new Quota(bucket.quota);
    const size_raw = quota.get_quota_by_size();
    const quantity_raw = quota.get_quota_by_quantity();
    return {
        limit_bytes: size_raw === '0' ? PG_BIGINT_MAX : size_raw,
        limit_objects: quantity_raw === '0' ? PG_BIGINT_MAX : quantity_raw,
    };
}

function _quota_exceeded_message(scope) {
    const name = scope.name && scope.name.unwrap ? scope.name.unwrap() : scope.name;
    return `The request was rejected because it would exceed the quota of bucket ${name}`;
}

/**
 * Admit bytes/objects against the cached counter. Returns a token for refund
 * when the following DB reserve fails. Non-strict buckets and empty deltas
 * return null.
 *
 * @param {object} scope
 * @param {{ bytes?: number, objects?: number }} delta

 */
async function check_quota_usage(scope, delta = {}) {
    if (!is_strict_quota_bucket(scope)) return null;
    // Missing Content-Length (MPU initiate, copy) must not throw inside BigInt().
    const bytes = Math.max(0, Number(delta.bytes) || 0);
    const objects = Math.max(0, Number(delta.objects) || 0);
    if (!bytes && !objects) return null;
    const scope_id = String(scope._id);
    const usage = await quota_usage_cache.get_with_cache({ scope_id });
    const { limit_bytes, limit_objects } = _limits_from_bucket(scope);
    const next_bytes = BigInt(usage.used_bytes) + BigInt(bytes);
    const next_objects = BigInt(usage.used_objects) + BigInt(objects);

    if (next_bytes > BigInt(limit_bytes) || next_objects > BigInt(limit_objects)) {
        dbg.warn('quota_usage_cache: would overflow', scope_id, {
            used: usage, bytes, objects}, "Quota limit is, size: ", limit_bytes, " counts: ", limit_objects);
        throw new RpcError('QUOTA_EXCEEDED', _quota_exceeded_message(scope));
    }
}


/**
 * Drop the cached row so the next admit reloads quotausages.
 *
 * @param {object} bucket
 */
function invalidate_bucket(bucket) {
    if (!bucket || !bucket._id) return;
    quota_usage_cache.invalidate({ scope_id: String(bucket._id) });
}

exports.quota_usage_cache = quota_usage_cache;
exports.is_strict_quota_bucket = is_strict_quota_bucket;
exports.check_quota_usage = check_quota_usage;
exports.invalidate_bucket = invalidate_bucket;
