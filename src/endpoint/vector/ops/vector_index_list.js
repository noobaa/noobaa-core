/* Copyright (C) 2026 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);
const { VectorError } = require('../vector_errors');
const { next_token_sanity_check } = require('../../../util/vectors_util');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_ListIndexes.html
 */
async function post_list_index(req, res) {

    dbg.log0("post_list_index body =", req.body);

    const max_results = req.body.maxResults || 500;
    const prefix = req.body.prefix;
    const vector_bucket_name = req.body.vectorBucketName;
    const next_token = req.body.nextToken;

    if (!next_token_sanity_check(next_token)) {
        throw new VectorError({
            code: VectorError.ValidationException.code,
            http_code: VectorError.ValidationException.http_code,
            message: VectorError.ValidationException.message,
            fieldList: [{path: 'nextToken', message: "Bad nextToken"}],
        });
    }

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
