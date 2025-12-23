/* Copyright (C) 2025 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_ListVectorBuckets.html
 */
async function post_list_vector_buckets(req, res) {

    dbg.log0("post_list_vectors body = ", req.body);

    const list = await req.object_sdk.list_vector_buckets({
        max_results: req.body.maxResults,
        prefix: req.body.prefix,
    });

    dbg.log0("post_list_vector_buckets list =", list);

    return {
        vectorBuckets: list.map(vb => ({
                creationTime: new Date(vb.creation_time).toISOString(),
                vectorBucketName: vb.name
            })
        )
    };
}

exports.handler = post_list_vector_buckets;
