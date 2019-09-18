/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETEwebsite.html
 */
async function delete_bucket_website(req) {
    await req.object_sdk.delete_bucket_website({ name: req.params.bucket });
}

module.exports = {
    handler: delete_bucket_website,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
