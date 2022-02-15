/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');
const mime = require('mime');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadInitiate.html
 * AKA Create Multipart Upload
 */
async function post_object_uploads(req, res) {
    const tagging = s3_utils.parse_tagging_header(req);
    const encryption = s3_utils.parse_encryption(req);
    const reply = await req.object_sdk.create_object_upload({
        bucket: req.params.bucket,
        key: req.params.key,
        content_type: req.headers['content-type'] || mime.getType(req.params.key) || 'application/octet-stream',
        content_encoding: req.headers['content-encoding'],
        xattr: s3_utils.get_request_xattr(req),
        tagging,
        encryption
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
