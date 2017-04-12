/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETwebsite.html
 */
function get_bucket_website(req) {
    return req.rpc_client.bucket.read_bucket({
            name: req.params.bucket
        })
        .then(bucket_info => {
            throw new S3Error(S3Error.NoSuchWebsiteConfiguration);
        });
}

module.exports = {
    handler: get_bucket_website,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
