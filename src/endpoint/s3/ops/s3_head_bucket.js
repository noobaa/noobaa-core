/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketHEAD.html
 */
function head_bucket(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            // only called to check for existence
            // no headers or reply needed
        });
}

module.exports = {
    handler: head_bucket,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
