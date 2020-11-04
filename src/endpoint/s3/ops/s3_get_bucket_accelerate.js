/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETaccelerate.html
 */
async function get_bucket_accelerate(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    return {
        AccelerateConfiguration: ''
    };
}

module.exports = {
    handler: get_bucket_accelerate,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
