/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETpolicy.html
 */
function get_bucket_policy(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            if (!bucket_info.s3_policy) {
                throw new S3Error(S3Error.NoSuchBucketPolicy);
            }
            return bucket_info.s3_policy;
        });
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
