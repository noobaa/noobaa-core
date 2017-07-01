/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETlocation.html
 */
function get_bucket_location(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => ({
            LocationConstraint: '' // default US East
        }));
}

module.exports = {
    handler: get_bucket_location,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
