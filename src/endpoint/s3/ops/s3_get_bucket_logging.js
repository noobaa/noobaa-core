/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETlogging.html
 */
function get_bucket_logging(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => ({
            BucketLoggingStatus: ''
        }));
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
