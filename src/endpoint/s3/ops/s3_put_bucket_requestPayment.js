/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTrequestPaymentPUT.html
 */
async function put_bucket_requestPayment(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    // TODO S3 put_bucket_requestPayment not implemented
    throw new S3Error(S3Error.NotImplemented);
}

module.exports = {
    handler: put_bucket_requestPayment,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
