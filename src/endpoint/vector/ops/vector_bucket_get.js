/* Copyright (C) 2026 NooBaa */
'use strict';
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_GetVectorBucket.html
 */
async function post_get_vector_bucket(req, res) {

    dbg.log0("post_get_vector_bucket body =", req.body);

    const vector_bucket_name = req.body.vectorBucketName;

    const vb = await req.vector_sdk.get_vector_bucket({ vector_bucket_name});

    return {
        vectorBucket: {
            vectorBucketName: vb.name,
            creationTime: vb.creation_time / 1000,
        }
    };
}

exports.handler = post_get_vector_bucket;

