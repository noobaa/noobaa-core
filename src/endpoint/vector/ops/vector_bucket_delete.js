/* Copyright (C) 2025 NooBaa */
'use strict';
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_DeleteVectorBucket.html
 */
async function post_delete_vector_bucket(req, res) {

    dbg.log0("post_delete_vector_bucket body =", req.body);

    const vector_bucket_name = req.body.vectorBucketName;

    await req.vector_sdk.delete_vector_bucket({ vector_bucket_name});
}

exports.handler = post_delete_vector_bucket;

