/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTrequestPaymentGET.html
 */
async function get_bucket_requestPayment(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    return {
        RequestPaymentConfiguration: {
            Payer: 'BucketOwner'
        }
    };
}

module.exports = {
    handler: get_bucket_requestPayment,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
