/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTrequestPaymentGET.html
 */
async function get_bucket_request_payment(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    const payer = 'BucketOwner';
    dbg.log1(`s3_get_bucket_request_payment (returns ${payer} on every request)`);
    return {
        RequestPaymentConfiguration: {
            Payer: payer
        }
    };
}

module.exports = {
    handler: get_bucket_request_payment,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
