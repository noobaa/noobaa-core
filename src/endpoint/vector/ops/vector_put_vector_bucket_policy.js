/* Copyright (C) 2025 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const VectorError = require('../vector_errors').VectorError;

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_PutVectorBucketPolicy.html
 */
async function put_vector_bucket_policy(req, res) {
    dbg.log1("put_vector_bucket_policy body =", req.body);

    const vector_bucket_name = req.body.vectorBucketName;
    if (!vector_bucket_name) {
        throw new VectorError(VectorError.ValidationException);
    }

    let policy;
    try {
        policy = JSON.parse(req.body.policy);
    } catch (error) {
        dbg.error('put_vector_bucket_policy: Invalid policy JSON', error);
        throw new VectorError(VectorError.ValidationException);
    }

    try {
        await req.vector_sdk.put_vector_bucket_policy({
            name: vector_bucket_name,
            policy,
        });
    } catch (error) {
        if (error.rpc_code === 'MALFORMED_POLICY' ||
            error.rpc_code === 'INVALID_SCHEMA' ||
            error.rpc_code === 'INVALID_SCHEMA_PARAMS') {
            const err = new VectorError(VectorError.ValidationException);
            err.message = 'The provided policy is malformed or invalid';
            throw err;
        }
        throw error;
    }
}

exports.handler = put_vector_bucket_policy;
