/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTencryption.html
 */
async function put_bucket_encryption(req) {
    const encryption = s3_utils.parse_body_encryption_xml(req);
    return req.object_sdk.put_bucket_encryption({
        name: req.params.bucket,
        encryption
    });
}

module.exports = {
    handler: put_bucket_encryption,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
