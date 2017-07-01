/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETtagging.html
 */
function get_bucket_tagging(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => ({
            Tagging: {}
        }));
}

module.exports = {
    handler: get_bucket_tagging,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
