/* Copyright (C) 2026 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

const { VectorError } = require('../vector_errors');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_GetVectors.html
 */
async function post_get_vectors(req, res) {

    dbg.log0("post_get_vectors body = ", req.body);

    if (!Array.isArray(req.body.keys) || req.body.keys.length === 0) {
        throw new VectorError({
            code: VectorError.ValidationException.code,
            http_code: VectorError.ValidationException.http_code,
            message: VectorError.ValidationException.message,
            fieldList: [{path: 'keys', message: "Invalid value."}],
        });
    }

    const list = await req.vector_sdk.get_vectors({
        vector_bucket_name: req.body.vectorBucketName,
        vector_index_name: req.body.indexName,
        keys: req.body.keys,
        return_metadata: req.body.returnMetadata,
    });

    return list;
}

exports.handler = post_get_vectors;

