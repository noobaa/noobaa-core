/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETEpolicy.html
 */
async function delete_bucket_policy(req) {
    await req.object_sdk.delete_bucket_policy({ name: req.params.bucket });
}

module.exports = {
    handler: delete_bucket_policy,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
