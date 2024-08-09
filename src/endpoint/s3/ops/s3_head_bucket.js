/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require("../s3_utils");

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketHEAD.html
 */
async function head_bucket(req, res) {
    const bucket_info = await req.object_sdk.read_bucket({ name: req.params.bucket });
    s3_utils.set_response_supported_storage_classes(res, bucket_info.supported_storage_classes);
}

module.exports = {
    handler: head_bucket,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
