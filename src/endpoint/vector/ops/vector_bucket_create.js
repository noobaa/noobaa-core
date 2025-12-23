/* Copyright (C) 2025 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateVectorBucket.html
 */
async function post_vector_bucket(req, res) {

    dbg.log0("post_vector_bucket req_params = ", req.params, ", body =", req.body);

    const vector_bucket_name = req.body.vectorBucketName;

    await req.object_sdk.create_vector_bucket({ name: vector_bucket_name});
}

module.exports = {
    handler: post_vector_bucket,
    body: { //TODO - remove?
        type: 'json',
        optional: false,
    },
    reply: {
        type: 'json',
    },
};
