/* Copyright (C) 2025 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUT.html
 */
async function post_vector_bucket(req, res) {

    dbg.log0("DDDDDDDDDDD post_vector_bucket req_params = ", req.params);

    await req.object_sdk.create_vector_bucket({ vector_bucket_name: req.params.vectorBucketName});
}

module.exports = {
    handler: post_vector_bucket,
    body: {
        type: 'json',
        optional: false,
    },
    reply: {
        type: 'json',
    },
};
