/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketDELETEcors.html
 */
async function delete_bucket_cors(req) {
    await req.object_sdk.delete_bucket_cors({
        name: req.params.bucket,
    });
}

module.exports = {
    handler: delete_bucket_cors,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
