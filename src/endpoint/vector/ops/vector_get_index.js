/* Copyright (C) 2025 NooBaa */
'use strict';
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_GetIndex.html
 */
async function post_get_index(req, res) {

    dbg.log0("post_get_index body = ", req.body);

    const index_md = await req.vector_sdk.get_index({
        vector_bucket_name: req.body.vectorBucketName,
        index_name: req.body.indexName,
        index_arn: req.body.indexArn,
    });

    dbg.log0("post_get_index index_md =", index_md);

    if (!index_md) return {};

    return {
        index: {
            indexName: index_md.index_name,
            vectorBucketName: index_md.vector_bucket_name,
            dimension: index_md.dimension,
            dataType: index_md.data_type,
            distanceMetric: index_md.distance_metric,
            metadataConfiguration: index_md.metadata_keys.length > 0 ?
            { nonFilterableMetadataKeys: index_md.metadata_keys } : undefined,
        }
    };
}

exports.handler = post_get_index;
