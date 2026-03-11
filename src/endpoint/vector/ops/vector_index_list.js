/* Copyright (C) 2026 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_ListIndexes.html
 */
async function post_list_index(req, res) {

    dbg.log0("post_list_index body =", req.body);

    const max_results = req.body.maxResults || 500;
    const prefix = req.body.prefix;
    const vector_bucket_name = req.body.vectorBucketName;
    const next_token = req.body.nextToken;

    const list_res = await req.vector_sdk.list_vector_indices({
        vector_bucket_name,
        max_results,
        prefix,
        next_token
    });

    return {
        indexes: list_res.items.map(vi => ({
                creationTime: vi.creation_time / 1000,
                indexName: vi.name,
                vectorBucketName: vi.vector_bucket
            })
        ),
        nextToken: list_res.next_token
    };
}

exports.handler = post_list_index;
