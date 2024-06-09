/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require("../../../util/sensitive_string");

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETlogging.html
 */
async function get_bucket_logging(req) {
    const logging = await req.object_sdk.get_bucket_logging({
        name: req.params.bucket,
    });
    return {
        BucketLoggingStatus: logging ? {
            LoggingEnabled: {
                TargetBucket: logging.log_bucket instanceof SensitiveString ? logging.log_bucket.unwrap() : logging.log_bucket,
                TargetPrefix: logging.log_prefix,
            }
        } : ''
    };
}

module.exports = {
    handler: get_bucket_logging,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
