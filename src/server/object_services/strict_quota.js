/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const { RpcError } = require('../../rpc');
const Quota = require('../system_services/objects/quota');
const { BucketQuotaStore, PG_BIGINT_MAX } = require('./bucket_quota_store');
const quota_usage_cache = require('./quota_usage_cache');

function is_strict_quota_bucket(bucket) {
    return Boolean(bucket && bucket.quota && bucket.quota.mode === 'strict');
}

/**
 * @param {object} bucket
 * @returns {{ limit_bytes: string, limit_objects: string }}
 */
function get_strict_limits(bucket) {
    const quota = new Quota(bucket.quota);
    const size_raw = quota.get_quota_by_size();
    const quantity_raw = quota.get_quota_by_quantity();
    return {
        limit_bytes: size_raw === '0' ? PG_BIGINT_MAX : size_raw,
        limit_objects: quantity_raw === '0' ? PG_BIGINT_MAX : quantity_raw,
    };
}

function _object_size(obj) {
    if (!obj) return 0;
    const md = obj.data || obj;
    const size = md.size;
    if (typeof size === 'number' && size > 0) return size;
    return 0;
}

/**
 * Reserve bytes and/or objects. Throws QUOTA_EXCEEDED when the atomic increment
 * is rejected by the WHERE cap (this endpoint or another one would overflow).
 *
 * @param {object} bucket
 * @param {String} object_id
 * @param {{ bytes?: number, objects?: number }} delta
 */
async function reserve_bucket_quota(bucket, object_id, { bytes = 0, objects = 0 } = {}) {
    if (!is_strict_quota_bucket(bucket)) return;
    if (!bytes && !objects) return;
    // Cache admit and the bucketquotas update share one queue so concurrent
    // creates on this server cannot both pass a stale counter.
    await quota_usage_cache.enqueue(bucket, async () => {
        const { limit_bytes, limit_objects } = get_strict_limits(bucket);
        const ok = await BucketQuotaStore.instance().try_reserve_bucket_quota({
                bucket_id: bucket._id,
                object_id,
                delta_bytes: bytes,
                delta_objects: objects,
                limit_bytes,
                limit_objects,
            });
        if (!ok) {
            const message = `The request was rejected because it would exceed the quota of bucket ${
                bucket.name && bucket.name.unwrap ? bucket.name.unwrap() : bucket.name
            }`;
            dbg.warn('strict_quota.reserve_bucket_quota: overflow', String(bucket._id), { bytes, objects });
            throw new RpcError('QUOTA_EXCEEDED', message);
        }
    });
}

/**
 * @param {object} bucket
 * @param {string} object_id
 * @param {{ bytes?: number, objects?: number }} delta
 */
async function release_bucket_quota(bucket, object_id, { bytes = 0, objects = 0 } = {}) {
    if (!is_strict_quota_bucket(bucket)) return;
    if (!bytes && !objects) return;
    try {
        await BucketQuotaStore.instance().release_bucket_quota({
            bucket_id: bucket._id,
            object_id,
            delta_bytes: bytes,
            delta_objects: objects,
        });
    } catch (err) {
        // Release must not fail the user path (delete/abort). Leak is conservative.
        dbg.error('strict_quota.release_bucket_quota: failed', String(bucket._id), { bytes, objects }, err);
    }
    await quota_usage_cache.enqueue(bucket, () => {
        quota_usage_cache.invalidate_bucket(bucket);
    });
}

/**
 * Latest used_bytes / used_objects from bucketquotas. Missing row is zeros
 * (fail-closed happens on reserve).
 *
 * @param {object} bucket
 * @returns {Promise<{ used_bytes: number, used_objects: number }>}
 */
async function read_usage(bucket) {
    if (!is_strict_quota_bucket(bucket)) {
        return { used_bytes: 0, used_objects: 0 };
    }
    const usage = await BucketQuotaStore.instance().get_usage(bucket._id);
    if (!usage) return { used_bytes: 0, used_objects: 0 };
    return usage;
}

/**
 * Simple PUT and multipart complete: +1 object, and +size when the final size is known.
 * Overwrite of a null version uses adjust_object_size instead of this.
 * @param {object} bucket
 * @param {{ _id: string, size?: number }} info
 */
async function reserve_object_upload(bucket, info) {
    const bytes = (typeof info.size === 'number' && info.size >= 0) ? info.size : 0;
    await reserve_bucket_quota(bucket, info._id, { bytes, objects: 1 });
}

/**
 * If complete size differs from the size reserved at create, adjust.
 * No-op when the object already had the same size (typical Content-Length PUT).
 * @param {object} bucket
 * @param {object} obj
 * @param {number} final_size
 */
async function adjust_object_size(bucket, obj, final_size) {
    if (!is_strict_quota_bucket(bucket)) return;
    const reserved = (typeof obj.size === 'number' && obj.size >= 0) ? obj.size : 0;
    const next = (typeof final_size === 'number' && final_size >= 0) ? final_size : 0;
    const delta = next - reserved;
    if (delta > 0) {
        await reserve_bucket_quota(bucket, obj._id, { bytes: delta, objects: 0 });
    } else if (delta < 0) {
        await release_bucket_quota(bucket, obj._id, { bytes: -delta, objects: 0 });
    }
}

/**
 * Release a simple-upload reservation recorded on object.size.
 * In-progress multipart uploads are not reserved until complete, so abort does not call this.
 * @param {object} bucket
 * @param {object} obj
 */
async function release_object_upload(bucket, obj) {
    if (!is_strict_quota_bucket(bucket) || !obj) return;
    const bytes = _object_size(obj);
    await release_bucket_quota(bucket, obj._id, { bytes, objects: 1 });
}

/**
 * Completed (or overwritten) object no longer consumes quota.
 * @param {object} bucket
 * @param {object} obj
 */
async function release_completed_object(bucket, obj) {
    if (!obj) return;
    await release_bucket_quota(bucket, obj._id, { bytes: _object_size(obj), objects: 1 });
}

/**
 * Batch release for lifecycle / bulk delete rows (`{ data }` or objectmd).
 * @param {object} bucket
 * @param {object[]} objects
 */
async function release_object_rows(bucket, objects) {
    if (!is_strict_quota_bucket(bucket) || !objects || !objects.length) return;

    for (const object of objects) {
        const obj = object.data || object;
        // In-progress uploads are not reserved until complete. Delete markers are not reserved.
        if (!obj || obj.delete_marker || obj.upload_started) continue;
        const bytes = _object_size(obj);
        await release_bucket_quota(bucket, obj._id, { bytes, objects: 1 });
    }
}


exports.is_strict_quota_bucket = is_strict_quota_bucket;
exports.get_strict_limits = get_strict_limits;
exports.reserve_bucket_quota = reserve_bucket_quota;
exports.release_bucket_quota = release_bucket_quota;
exports.read_usage = read_usage;
exports.reserve_object_upload = reserve_object_upload;
exports.adjust_object_size = adjust_object_size;
exports.release_object_upload = release_object_upload;
exports.release_completed_object = release_completed_object;
exports.release_object_rows = release_object_rows;
exports._object_size = _object_size;
