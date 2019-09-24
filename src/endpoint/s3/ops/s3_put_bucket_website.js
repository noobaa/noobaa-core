/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTwebsite.html
 */
async function put_bucket_website(req) {
    const website = s3_utils.parse_body_website_xml(req);
    await req.object_sdk.put_bucket_website({
        name: req.params.bucket,
        website
    });
}

module.exports = {
    handler: put_bucket_website,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
