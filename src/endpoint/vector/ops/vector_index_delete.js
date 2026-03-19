/* Copyright (C) 2026 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_DeleteIndex.html
 */
async function post_delete_index(req, res) {

    dbg.log0("post_delete_index body =", req.body);

    const vector_index_name = req.body.indexName;
    const vector_bucket_name = req.body.vectorBucketName;

    await req.vector_sdk.delete_vector_index({
        vector_index_name,
        vector_bucket_name,
    });
}

exports.handler = post_delete_index;

