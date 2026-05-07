/* Copyright (C) 2025 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

const { VectorError } = require('../vector_errors');
/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_PutVectors.html
 */
async function post_put_vectors(req, res) {

    dbg.log0("post_put_vectors body = ", req.body);

    //validate vectors length matches index's dimension
    const vectors = req.body.vectors;
    const dimension = req.vector_index.dimension;

    for (const vector of vectors) {
        if (vector.data?.float32?.length !== dimension) {
            throw new VectorError({
                code: VectorError.ValidationException.code,
                http_code: VectorError.ValidationException.http_code,
                message: `Invalid record for key ${vector.key}: vector must have length ${dimension}, but has length ${vector.data?.float32?.length}`,
                fieldList: [{path: 'vectors', message: "Vector has different dimension than index."}],
            });
        }
    }


    await req.vector_sdk.put_vectors({
        vector_bucket_name: req.body.vectorBucketName,
        vector_index_name: req.body.indexName,
        vectors: req.body.vectors,
    });
}

exports.handler = post_put_vectors;
