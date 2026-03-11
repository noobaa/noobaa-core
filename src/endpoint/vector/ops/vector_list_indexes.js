/* Copyright (C) 2025 NooBaa */
'use strict';
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_ListIndexes.html
 */
async function post_list_indexes(req, res) {

    dbg.log0("post_list_indexes body = ", req.body);

    const indexes = await req.vector_sdk.list_indexes({
        vector_bucket_name: req.body.vectorBucketName,
        prefix: req.body.prefix,
        max_results: req.body.maxResults,
    });

    dbg.log0("post_list_indexes indexes =", indexes);

    return {
        indexes: indexes.map(idx => ({
            indexName: idx.index_name,
            vectorBucketName: idx.vector_bucket_name,
        }))
    };
}

exports.handler = post_list_indexes;
