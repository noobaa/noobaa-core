/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETEencryption.html
 */
async function delete_bucket_encryption(req) {
    return req.object_sdk.delete_bucket_encryption({
        name: req.params.bucket
    });
}

module.exports = {
    handler: delete_bucket_encryption,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
