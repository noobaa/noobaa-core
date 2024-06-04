/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTlogging.html
 */
async function put_bucket_logging(req) {
    const logging = s3_utils.parse_body_logging_xml(req);
    if (logging.log_bucket) {
        return req.object_sdk.put_bucket_logging({
            name: req.params.bucket,
            logging
        });
    }
    return req.object_sdk.delete_bucket_logging({
        name: req.params.bucket,
    });
}

module.exports = {
    handler: put_bucket_logging,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
