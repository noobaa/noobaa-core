/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTpolicy.html
 */
async function put_bucket_policy(req) {
    const policy = req.body;
    try {
        JSON.parse(policy);
    } catch (error) {
        console.error('put_bucket_policy: Invalid JSON provided', error);
        throw new S3Error(S3Error.InvalidArgument);
    }

    await req.object_sdk.put_bucket_policy({ name: req.params.bucket, policy });
}

module.exports = {
    handler: put_bucket_policy,
    body: {
        type: 'json',
    },
    reply: {
        type: 'empty',
    },
};
