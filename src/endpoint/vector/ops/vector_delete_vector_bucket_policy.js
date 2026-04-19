/* Copyright (C) 2025 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const VectorError = require('../vector_errors').VectorError;

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_DeleteVectorBucketPolicy.html
 */
async function delete_vector_bucket_policy(req, res) {
    dbg.log1("delete_vector_bucket_policy body =", req.body);

    const vector_bucket_name = req.body.vectorBucketName;
    if (!vector_bucket_name) {
        throw new VectorError(VectorError.ValidationException);
    }

    await req.vector_sdk.delete_vector_bucket_policy({
        vector_bucket_name,
    });
}

exports.handler = delete_vector_bucket_policy;
