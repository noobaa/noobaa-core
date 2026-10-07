/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const LRUCache = require('../../util/lru_cache');
const { RpcError } = require('../../rpc');
const Quota = require('../system_services/objects/quota');
const { BucketQuotaStore, PG_BIGINT_MAX } = require('./bucket_quota_store');

/**
 * Object-server cache of bucketquotas.used_bytes / used_objects.
 *
 * create_object_upload and create_multipart admit through strict_quota.reserve,
 * which consults this cache instead of SELECTing bucketquotas on every request.
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
     * @param {{ bucket_id: string }} params
     */
    make_key: params => String(params.bucket_id),
    /**
     * @param {{ bucket_id: string }} params
     */
    load: async params => {
        const usage = await BucketQuotaStore.instance().get_usage(params.bucket_id);
        return {
            used_bytes: Number(usage && usage.used_bytes) || 0,
            used_objects: Number(usage && usage.used_objects) || 0,
        };
    },
});

// Serializes cache read-modify-write with the DB reserve for one bucket.
// Concurrent admits otherwise share one event loop and can both pass the check.
const _tails = new Map();

/**
 * @param {object} bucket
 * @param {() => Promise<any>} fn
 */
function enqueue(bucket, fn) {
    const bucket_id = bucket && bucket._id ? String(bucket._id) : '';
    if (!bucket_id) return Promise.resolve().then(fn);
    const prev = _tails.get(bucket_id) || Promise.resolve();
    // Return the tail itself. A separate finally() promise would reject unhandled
    // when admit fails, which kills the process under Node's unhandledRejection.
    const settled = prev.then(fn, fn).then(
        value => {
            if (_tails.get(bucket_id) === settled) _tails.delete(bucket_id);
            return value;
        },
        err => {
            if (_tails.get(bucket_id) === settled) _tails.delete(bucket_id);
            throw err;
        },
    );
    _tails.set(bucket_id, settled);
    return settled;
}

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

function _quota_exceeded_message(bucket) {
    const name = bucket.name && bucket.name.unwrap ? bucket.name.unwrap() : bucket.name;
    return `The request was rejected because it would exceed the quota of bucket ${name}`;
}

/**
 * Admit bytes/objects against the cached counter. Returns a token for refund
 * when the following DB reserve fails. Non-strict buckets and empty deltas
 * return null.
 *
 * Callers that also update bucketquotas must run this inside enqueue() so the
 * cache update and the DB write stay ordered for the bucket.
 *
 * @param {object} bucket
 * @param {{ bytes?: number, objects?: number }} delta

 */
 // @returns {Promise<{ bucket_id: string, bytes: number, objects: number }|null>}
async function check_quota_usage(bucket, delta = {}) {
    // Missing Content-Length (MPU initiate, copy) must not throw inside BigInt().
    const bytes = Math.max(0, Number(delta.bytes) || 0);
    const objects = Math.max(0, Number(delta.objects) || 0);
    if (!bytes && !objects) return null;
    if (!is_strict_quota_bucket(bucket)) return null;
    const bucket_id = String(bucket._id);
    const usage = await quota_usage_cache.get_with_cache({ bucket_id });
    const { limit_bytes, limit_objects } = _limits_from_bucket(bucket);
    const next_bytes = BigInt(usage.used_bytes) + BigInt(bytes);
    const next_objects = BigInt(usage.used_objects) + BigInt(objects);
    if (next_bytes > BigInt(limit_bytes) || next_objects > BigInt(limit_objects)) {
        dbg.warn('quota_usage_cache: would overflow', bucket_id, {
            used: usage,
            bytes,
            objects,
        });
        throw new RpcError('QUOTA_EXCEEDED', _quota_exceeded_message(bucket));
    }
}


/**
 * Drop the cached row so the next admit reloads bucketquotas.
 *
 * @param {object} bucket
 */
function invalidate_bucket(bucket) {
    if (!bucket || !bucket._id) return;
    quota_usage_cache.invalidate({ bucket_id: String(bucket._id) });
}

exports.quota_usage_cache = quota_usage_cache;
exports.enqueue = enqueue;
exports.is_strict_quota_bucket = is_strict_quota_bucket;
exports.check_quota_usage = check_quota_usage;
exports.invalidate_bucket = invalidate_bucket;
