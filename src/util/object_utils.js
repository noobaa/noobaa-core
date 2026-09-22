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
    'target_data_info',
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
    'multiparts',
];

const CREATE_MULTIPART_PARAMS = [
    'obj_id',
    'bucket',
    'key',
    'num',
    'size',
    'md5_b64',
    'sha256_b64',
    'encryption',
];

const COMPLETE_MULTIPART_PARAMS = [
    'multipart_id',
    'obj_id',
    'bucket',
    'key',
    'num',
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

/**
 * Safely destroys an upload source stream if present.
 * @param {{ source_stream?: { destroy?: Function } }} params
 */
function destroy_source_stream(params) {
    if (params.source_stream && typeof params.source_stream.destroy === 'function') {
        params.source_stream.destroy();
    }
}

exports.CREATE_MULTIPART_PARAMS = CREATE_MULTIPART_PARAMS;
exports.COMPLETE_MULTIPART_PARAMS = COMPLETE_MULTIPART_PARAMS;
exports.get_create_object_upload_params = get_create_object_upload_params;
exports.get_complete_object_upload_params = get_complete_object_upload_params;
exports.destroy_source_stream = destroy_source_stream;
