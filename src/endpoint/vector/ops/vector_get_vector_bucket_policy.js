/* Copyright (C) 2025 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const VectorError = require('../vector_errors').VectorError;

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_GetVectorBucketPolicy.html
 */
async function get_vector_bucket_policy(req, res) {
    dbg.log1("get_vector_bucket_policy body =", req.body);

    const vector_bucket_name = req.body.vectorBucketName;
    if (!vector_bucket_name) {
        throw new VectorError(VectorError.ValidationException);
    }

    const reply = await req.vector_sdk.get_vector_bucket_policy({
        name: vector_bucket_name,
    });
    if (!reply.policy) {
        throw new VectorError(VectorError.NoSuchVectorBucketPolicy);
    }
    return { policy: JSON.stringify(reply.policy) };
}

exports.handler = get_vector_bucket_policy;
