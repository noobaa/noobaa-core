/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETlocation.html
 */
async function get_bucket_location(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    return {
        LocationConstraint: '' // default US East
    };
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
