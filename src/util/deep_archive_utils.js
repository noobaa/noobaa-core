/* Copyright (C) 2024 NooBaa */
'use strict';

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

exports.get_archive_key = get_archive_key;
