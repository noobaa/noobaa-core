/* Copyright (C) 2026 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateIndex.html
 */
async function post_create_index(req, res) {

    dbg.log0("post_create_index body =", req.body);

    const vector_index_name = req.body.indexName;
    const vector_bucket_name = req.body.vectorBucketName;
    const dimension = req.body.dimension;
    const distance_metric = req.body.distanceMetric;

    await req.vector_sdk.create_vector_index({
        vector_index_name,
        vector_bucket_name,
        dimension,
        distance_metric
    });
}

exports.handler = post_create_index;

