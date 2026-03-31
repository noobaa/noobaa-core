/* Copyright (C) 2025 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateVectorBucket.html
 */
async function post_vector_bucket(req, res) {

    dbg.log0("post_vector_bucket body =", req.body, ", headers =", req.headers);

    const ns_name = req.headers['x-noobaa-custom-ns'];
    const subpath = req.headers['x-noobaa-custom-subpath'];

    const namespace_resource = {
        resource: ns_name,
        path: subpath //not to be confused with nsr path
    };

    const vector_bucket_name = req.body.vectorBucketName;
    await req.vector_sdk.create_vector_bucket({
        vector_bucket_name,
        namespace_resource,
    });
}

exports.handler = post_vector_bucket;

