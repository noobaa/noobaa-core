/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETEtagging.html
 */
async function delete_bucket_tagging(req) {
    return req.object_sdk.delete_bucket_tagging({
        name: req.params.bucket
    });
}

module.exports = {
    handler: delete_bucket_tagging,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
