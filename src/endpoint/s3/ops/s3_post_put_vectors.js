/* Copyright (C) 2025 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_PutVectors.html
 */
async function post_put_vectors(req, res) {

    dbg.log0("post_put_vectors req_params = ", req.params, ", body = ", req.body);

    await req.object_sdk.put_vectors({
        vector_bucket_name: req.params.vectorBucketName || req.body.vectorBucketName,
        vectors: req.params.vectors || req.body.vectors,
    });
}

module.exports = {
    handler: post_put_vectors,
    body: {
        type: 'json',
        optional: false,
    },
    reply: {
        type: 'json',
    },
};
