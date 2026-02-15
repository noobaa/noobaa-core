/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');
const mime = require('mime-types');
const config = require('../../../../config');
const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadInitiate.html
 * AKA Create Multipart Upload
 */
async function post_object_uploads(req, res) {
    const tagging = s3_utils.parse_tagging_header(req);
    const encryption = s3_utils.parse_encryption(req);
    const storage_class = s3_utils.parse_storage_class_header(req);
    const lock_settings = config.WORM_ENABLED ? s3_utils.parse_lock_header(req) : undefined;
    if (config.DENY_UPLOAD_TO_STORAGE_CLASS_STANDARD && storage_class === s3_utils.STORAGE_CLASS_STANDARD) {
        throw new S3Error(S3Error.InvalidStorageClass);
    }

    const reply = await req.object_sdk.create_object_upload({
        bucket: req.params.bucket,
        key: req.params.key,
        content_type: req.headers['content-type'] || mime.lookup(req.params.key) || 'application/octet-stream',
        content_encoding: req.headers['content-encoding'],
        xattr: s3_utils.get_request_xattr(req),
        storage_class,
        tagging,
        encryption,
        lock_settings
    });

    s3_utils.set_encryption_response_headers(req, res, reply.encryption);

    return ({
        InitiateMultipartUploadResult: {
            Bucket: req.params.bucket,
            Key: req.params.key,
            UploadId: reply.obj_id
        }
    });
}

module.exports = {
    handler: post_object_uploads,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
