/* Copyright (C) 2016 NooBaa */
'use strict';

// const S3Error = require('../s3_errors').S3Error;

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETEreplication.html
 */
async function delete_bucket_replication(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    // TODO S3 delete_bucket_replication not implemented
}

module.exports = {
    handler: delete_bucket_replication,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
