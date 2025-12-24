/* Copyright (C) 2025 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_DeleteVectors.html
 */
async function post_delete_vectors(req, res) {

    dbg.log0("post_delete_vectors body = ", req.body);

    await req.object_sdk.delete_vectors({
        vector_bucket_name: req.body.vectorBucketName,
        keys: req.body.keys,
    });
}

exports.handler = post_delete_vectors;
