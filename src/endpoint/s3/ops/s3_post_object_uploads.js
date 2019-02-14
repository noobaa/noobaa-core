/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadInitiate.html
 * AKA Create Multipart Upload
 */
function post_object_uploads(req) {
    const tagging = s3_utils.parse_tagging_header(req);
    return req.object_sdk.create_object_upload({
            bucket: req.params.bucket,
            key: req.params.key,
            content_type: req.headers['content-type'],
            xattr: s3_utils.get_request_xattr(req),
            tagging
        })
        .then(reply => ({
            InitiateMultipartUploadResult: {
                Bucket: req.params.bucket,
                Key: req.params.key,
                UploadId: reply.obj_id
            }
        }));
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
