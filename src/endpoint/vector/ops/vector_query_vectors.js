/* Copyright (C) 2025 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_QueryVectors.html
 */
async function post_query_vectors(req, res) {

    dbg.log0("post_query_vectors req_params = ", req.params, ", body = ", req.body);

    const list = await req.object_sdk.query_vectors({
        vector_bucket_name: req.body.vectorBucketName,
        query_vector: req.body.queryVector,
        filter: req.body.filter,
        topk: req.body.topK,
        return_distance: req.body.returnDistance,
        return_metadata: req.body.returnMetadata,
    });

    dbg.log0("post_query_vectors list =", list);

    return list;
}

module.exports = {
    handler: post_query_vectors,
    body: {
        type: 'json',
        optional: false,
    },
    reply: {
        type: 'json',
    },
};
