/* Copyright (C) 2025 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_ListVectors.html
 */
async function post_list_vectors(req, res) {

    dbg.log0("post_list_vectors body = ", req.body);

    const list = await req.vector_sdk.list_vectors({
        vector_bucket_name: req.body.vectorBucketName,
        vector_index_name: req.body.indexName,
        max_results: req.body.maxResults,
        return_data: req.body.returnData,
        return_metadata: req.body.returnMetadata,
    });

    dbg.log0("post_list_vectors list =", list);

    return list;
}

exports.handler = post_list_vectors;
