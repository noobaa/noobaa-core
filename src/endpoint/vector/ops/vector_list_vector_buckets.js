/* Copyright (C) 2025 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);
const { VectorError } = require('../vector_errors');
const { next_token_sanity_check } = require('../../../util/vectors_util');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_ListVectorBuckets.html
 */
async function post_list_vector_buckets(req, res) {

    dbg.log0("post_list_vectors body = ", req.body);

    const max_results = req.body.maxResults || 500;
    const prefix = req.body.prefix;
    const next_token = req.body.nextToken;

    if (!next_token_sanity_check(next_token)) {
        throw new VectorError({
            code: VectorError.ValidationException.code,
            http_code: VectorError.ValidationException.http_code,
            message: VectorError.ValidationException.message,
            fieldList: [{path: 'nextToken', message: "Bad nextToken"}],
        });
    }

    const list_res = await req.vector_sdk.list_vector_buckets({
        max_results,
        prefix,
        next_token,
    });

    dbg.log0("post_list_vector_buckets list =", list_res);

    return {
        vectorBuckets: list_res.items.map(vb => ({
                //creationTime: new Date(vb.creation_time).toISOString(),
                creationTime: vb.creation_time / 1000,
                vectorBucketName: vb.name
            })
        ),
        nextToken: list_res.next_token,
    };
}

exports.handler = post_list_vector_buckets;
