/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadInitiate.html
 * AKA Create Multipart Upload
 */
function post_object_uploads(req) {
    return req.rpc_client.object.create_object_upload({
            bucket: req.params.bucket,
            key: req.params.key,
            content_type: req.headers['content-type'],
            md_conditions: http_utils.get_md_conditions(req),
            xattr: s3_utils.get_request_xattr(req),
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
