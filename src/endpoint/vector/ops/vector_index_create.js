/* Copyright (C) 2026 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

const { VectorError } = require('../vector_errors');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateIndex.html
 */
async function post_create_index(req, res) {

    dbg.log0("post_create_index body =", req.body);

    const vector_index_name = req.body.indexName;
    const vector_bucket_name = req.body.vectorBucketName;
    const dimension = req.body.dimension;
    const distance_metric = req.body.distanceMetric;
    const data_type = req.body.dataType;

    let metadata_configuration;
    if (req.body.metadataConfiguration) {
        metadata_configuration = {
            non_filterable_metadata_keys: req.body.metadataConfiguration?.nonFilterableMetadataKeys
        };
    }

    if (dimension < 1 || dimension > 4096) {
        throw new VectorError({
            code: VectorError.ValidationException.code,
            http_code: VectorError.ValidationException.http_code,
            message: VectorError.ValidationException.message,
            fieldList: [{path: 'dimension', message: "Invalid value."}],
        });
    }

    if (data_type !== 'float32') {
        throw new VectorError({
            code: VectorError.ValidationException.code,
            http_code: VectorError.ValidationException.http_code,
            message: VectorError.ValidationException.message,
            fieldList: [{path: 'dataType', message: "Invalid value."}],
        });
    }

    await req.vector_sdk.create_vector_index({
        vector_index_name,
        vector_bucket_name,
        data_type,
        dimension,
        distance_metric,
        metadata_configuration
    });
}

exports.handler = post_create_index;

