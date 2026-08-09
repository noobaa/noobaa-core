/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const S3Error = require('../endpoint/s3/s3_errors').S3Error;
const { GLACIER_STORAGE_CLASSES } = require('../endpoint/s3/s3_utils');
const { round_up_to_next_time_of_day } = require('../util/time_utils');

const NB_INTERNAL_STORAGE_DIR = 'noobaa_storage/';

/**
 * Returns the key used to store object data in the deep-archive backend.
 * Format: `{bucket_id}/{obj_md_id}`
 *
 * @param {string|nb.ID} bucket_id
 * @param {string|nb.ID} obj_md_id
 * @returns {string}
 */
function get_archive_key(bucket_id, obj_md_id) {
    return `${NB_INTERNAL_STORAGE_DIR}${String(bucket_id)}/${String(obj_md_id)}`;
}

/**
 * True when the object's data lives in a remote deep-archive namespace
 * (GLACIER/DEEP_ARCHIVE storage class + bucket archive_policy).
 * False for tiering GLACIER, where data lives in NB pools only.
 * @param {{ storage_class?: string }} obj
 * @param {{ archive_policy?: { deep_archive_resource?: object } }} [bucket]
 * @returns {boolean}
 */
function is_remote_archive_object(obj, bucket) {
    if (!GLACIER_STORAGE_CLASSES.includes(obj?.storage_class)) return false;
    return Boolean(bucket?.archive_policy?.deep_archive_resource);
}

/**
 * For glacier/archive storage classes, throws InvalidObjectState when the object
 * is not restored yet (restore ongoing, missing expiry_time, or expiry in the past).
 * No-op otherwise.
 * @param {string} bucket_name
 * @param {nb.ObjectInfo} object_md
 */
function throw_if_restore_incomplete(bucket_name, object_md) {
    if (!GLACIER_STORAGE_CLASSES.includes(object_md?.storage_class)) return;
    const restore_status = object_md?.restore_status;
    if (is_restore_active(restore_status)) return;
    // Don't try to read the object if it's not restored yet
    dbg.warn('Object is not restored yet', bucket_name, object_md.key, object_md.storage_class, object_md.restore_status);
    throw new S3Error(S3Error.InvalidObjectState);
}

/**
 * Returns true when restore_status represents an active temporary restore
 * (ongoing is false and expiry_time is in the future).
 * @param {nb.RestoreStatus} [restore_status]
 * @param {Date} [now]
 * @returns {boolean}
 */
function is_restore_active(restore_status, now = new Date()) {
    if (!restore_status || restore_status.ongoing ||
        restore_status.expiry_time === undefined || restore_status.expiry_time === null) {
        return false;
    }
    const expiry_time = new Date(restore_status.expiry_time);
    if (Number.isNaN(expiry_time.getTime())) return false;
    return expiry_time > now;
}

/**
 * Computes restore expiry as now + days, rounded up to the next midnight UTC
 * @param {number} days
 * @param {Date} [now]
 * @returns {Date}
 */
function compute_restore_expiry(days, now = new Date()) {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const expires_on = new Date(now.getTime() + days * MS_PER_DAY);
    round_up_to_next_time_of_day(expires_on, 0, 0, 0, 'UTC');
    return expires_on;
}


exports.get_archive_key = get_archive_key;
exports.is_remote_archive_object = is_remote_archive_object;
exports.throw_if_restore_incomplete = throw_if_restore_incomplete;
exports.is_restore_active = is_restore_active;
exports.compute_restore_expiry = compute_restore_expiry;
