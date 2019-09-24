/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETpolicy.html
 */
async function get_bucket_policy(req) {
    const reply = await req.object_sdk.get_bucket_policy({ name: req.params.bucket });
    if (!reply.policy) throw new S3Error(S3Error.NoSuchBucketPolicy);
    return reply.policy;
}

module.exports = {
    handler: get_bucket_policy,
    body: {
        type: 'empty',
        invalid_error: S3Error.InvalidPolicyDocument,
    },
    reply: {
        type: 'json',
    },
};
