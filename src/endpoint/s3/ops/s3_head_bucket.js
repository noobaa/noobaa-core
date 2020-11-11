/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketHEAD.html
 */
async function head_bucket(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    // only called to check for existence
    // no headers or reply needed
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
