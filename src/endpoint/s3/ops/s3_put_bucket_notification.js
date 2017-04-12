/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTnotification.html
 */
function put_bucket_notification(req) {
    return req.rpc_client.bucket.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            // TODO S3 put_bucket_notification not implemented
            throw new S3Error(S3Error.NotImplemented);
        });
}

module.exports = {
    handler: put_bucket_notification,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
