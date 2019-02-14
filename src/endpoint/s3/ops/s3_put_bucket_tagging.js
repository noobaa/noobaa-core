/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTtagging.html
 */
async function put_bucket_tagging(req) {
    const tag_set = s3_utils.parse_body_tagging_xml(req);
    return req.object_sdk.put_bucket_tagging({
        name: req.params.bucket,
        tagging: tag_set
    });
}

module.exports = {
    handler: put_bucket_tagging,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
