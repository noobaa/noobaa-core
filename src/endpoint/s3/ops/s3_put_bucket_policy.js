/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTpolicy.html
 */
async function put_bucket_policy(req) {
    let policy;
    try {
        policy = JSON.parse(JSON.stringify(req.body).toLowerCase());
    } catch (error) {
        console.error('put_bucket_policy: Invalid JSON provided', error);
        throw new S3Error(S3Error.InvalidArgument);
    }
    // adapting bucket policy to our schema
    for (const statement of policy.statement) {
        if (statement.principal) {
            if (statement.principal.aws) statement.principal = statement.principal.aws;
            statement.principal = _.flatten([statement.principal]);
        }
        if (statement.action) statement.action = _.flatten([statement.action]);
        if (statement.resource) statement.resource = _.flatten([statement.resource]);
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
