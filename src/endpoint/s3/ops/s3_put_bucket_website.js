/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTwebsite.html
 */
function put_bucket_metrics(req) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            // TODO S3 put_bucket_metrics not implemented
            throw new S3Error(S3Error.NotImplemented);
        });
}

module.exports = {
    handler: put_bucket_metrics,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
