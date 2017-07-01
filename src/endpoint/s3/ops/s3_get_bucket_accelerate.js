/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETaccelerate.html
 */
function get_bucket_accelerate(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => ({
            AccelerateConfiguration: ''
        }));
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
