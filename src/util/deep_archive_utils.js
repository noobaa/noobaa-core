/* Copyright (C) 2024 NooBaa */
'use strict';

const NB_INTERNAL_STORAGE_DIR = 'noobaa_storage/';
const dbg = require('../util/debug_module')(__filename);
const S3Error = require('../endpoint/s3/s3_errors').S3Error;
const { GLACIER_STORAGE_CLASSES } = require('../endpoint/s3/s3_utils');



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
 * For glacier/archive storage classes, throws InvalidObjectState when the object
 * is not restored yet (restore ongoing, missing expiry_time, or expiry in the past).
 * No-op otherwise.
 * @param {string} bucket_name
 * @param {nb.ObjectInfo} object_md
 */
function throw_if_restore_incomplete(bucket_name, object_md) {
    if (!GLACIER_STORAGE_CLASSES.includes(object_md?.storage_class)) return;
    const restore = object_md.restore_status;
    const expiry_time = restore?.expiry_time && new Date(restore.expiry_time);
    const is_restored = Boolean(expiry_time) && !restore.ongoing && expiry_time > new Date();
    if (is_restored) return;
    // Don't try to read the object if it's not restored yet
    dbg.warn('Object is not restored yet', bucket_name, object_md.key, object_md.storage_class, restore);
    throw new S3Error(S3Error.InvalidObjectState);
}

exports.get_archive_key = get_archive_key;
exports.throw_if_restore_incomplete = throw_if_restore_incomplete;
