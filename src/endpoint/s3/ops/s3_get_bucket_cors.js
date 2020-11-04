/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETcors.html
 */
async function get_bucket_cors(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    return {
        CORSConfiguration: ''
    };
}

module.exports = {
    handler: get_bucket_cors,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
