/* Copyright (C) 2016 NooBaa */
'use strict';
const config = require('../../../../config');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUT.html
 */
async function put_bucket(req, res) {
    const lock_enabled = config.WORM_ENABLED ? req.headers['x-amz-bucket-object-lock-enabled'] &&
        req.headers['x-amz-bucket-object-lock-enabled'].toUpperCase() === 'TRUE' : undefined;
    await req.object_sdk.create_bucket({ name: req.params.bucket, lock_enabled: lock_enabled });
    res.setHeader('Location', '/' + req.params.bucket);
}

module.exports = {
    handler: put_bucket,
    body: {
        type: 'xml',
        // body is optional since it may contain region name (location constraint)
        // or use the default US East region when not included
        optional: true,
    },
    reply: {
        type: 'empty',
    },
};
