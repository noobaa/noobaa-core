/* Copyright (C) 2026 NooBaa */
'use strict';

const _ = require('lodash');

const CREATE_OBJECT_UPLOAD_PARAMS = [
    'bucket',
    'key',
    'content_type',
    'content_encoding',
    'size',
    'md5_b64',
    'sha256_b64',
    'xattr',
    'tagging',
    'encryption',
    'lock_settings',
    'storage_class',
    'last_modified_time',
    'archive_upload_id',
];

const COMPLETE_OBJECT_UPLOAD_PARAMS = [
    'obj_id',
    'bucket',
    'key',
    'md_conditions',
    'size',
    'md5_b64',
    'sha256_b64',
    'etag',
    'num_parts',
    'last_modified_time',
];

/**
 * Picks the params accepted by object.create_object_upload.
 * @param {object} params
 * @returns {object}
 */
function get_create_object_upload_params(params) {
    return _.pick(params, CREATE_OBJECT_UPLOAD_PARAMS);
}

/**
 * Picks the params accepted by object.complete_object_upload.
 * @param {object} params
 * @returns {object}
 */
function get_complete_object_upload_params(params) {
    return _.pick(params, COMPLETE_OBJECT_UPLOAD_PARAMS);
}

exports.get_create_object_upload_params = get_create_object_upload_params;
exports.get_complete_object_upload_params = get_complete_object_upload_params;
