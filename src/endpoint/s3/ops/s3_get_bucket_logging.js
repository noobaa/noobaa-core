/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETlogging.html
 */
async function get_bucket_logging(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    return {
        BucketLoggingStatus: ''
    };
}

module.exports = {
    handler: get_bucket_logging,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
