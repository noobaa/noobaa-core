/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETversioningStatus.html
 */
async function get_bucket_versioning(req) {

    return await req.object_sdk.get_bucket_versioning({name: req.params.bucket});
}

module.exports = {
    handler: get_bucket_versioning,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
