/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTpolicy.html
 */
async function put_bucket_policy(req) {
    let policy;
    try {
        policy = JSON.parse(JSON.stringify(req.body));
    } catch (error) {
        console.error('put_bucket_policy: Invalid JSON provided', error);
        throw new S3Error(S3Error.InvalidArgument);
    }
    try {
        await req.object_sdk.put_bucket_policy({ name: req.params.bucket, policy });
    } catch (error) {
        let err = error;
        if (error.rpc_code === "INVALID_SCHEMA") {
            err = new S3Error(S3Error.MalformedPolicy);
            err.message = "Policy was not well formed or did not validate against the published schema";
        }
        throw err;
    }
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
