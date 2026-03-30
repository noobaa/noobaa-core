/* Copyright (C) 2026 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_GetIndex.html
 */
async function post_get_index(req, res) {

    dbg.log0("post_get_index body =", req.body);

    const vector_index_info = req.vector_index;

    return {
        index: {
            indexName: vector_index_info.name,
            vectorBucketName: vector_index_info.vector_bucket,
            dimension: vector_index_info.dimension,
            dataType: vector_index_info.data_type,
            distanceMetric: vector_index_info.distance_metric,
            creationTime: vector_index_info.creation_time / 1000,
            metadataConfiguration: vector_index_info.metadata_configuration,
        }
    };
}

exports.handler = post_get_index;

