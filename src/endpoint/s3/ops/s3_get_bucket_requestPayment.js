/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTrequestPaymentGET.html
 */
function get_bucket_requestPayment(req) {
    return req.rpc_client.bucket.read_bucket({
            name: req.params.bucket
        })
        .then(bucket_info => ({
            RequestPaymentConfiguration: {
                Payer: 'BucketOwner'
            }
        }));
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
