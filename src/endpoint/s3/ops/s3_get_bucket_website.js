/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketGETwebsite.html
 */
async function get_bucket_website(req) {
    const reply = await req.object_sdk.get_bucket_website({ name: req.params.bucket });
    if (!reply.website) throw new S3Error(S3Error.NoSuchWebsiteConfiguration);
    const parsed = s3_utils.parse_website_to_body(reply.website);
    return parsed;
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
