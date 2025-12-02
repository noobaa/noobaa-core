/* Copyright (C) 2016 NooBaa */
'use strict';
const config = require('../../../../config');


/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUT.html
 */
async function put_bucket(req, res) {
    const lock_enabled = config.WORM_ENABLED ? req.headers['x-amz-bucket-object-lock-enabled'] &&
        req.headers['x-amz-bucket-object-lock-enabled'].toUpperCase() === 'TRUE' : undefined;
    const custom_bucket_path = req.headers[config.NSFS_CUSTOM_BUCKET_PATH_HTTP_HEADER];
    await req.object_sdk.create_bucket({ name: req.params.bucket, lock_enabled, custom_bucket_path });
    if (config.allow_anonymous_access_in_test && req.headers['x-amz-acl'] === 'public-read') { // For now we will enable only for tests
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: { AWS: ["*"] },
                Action: ['s3:GetObject', 's3:ListBucket'],
                Resource: ['arn:aws:s3:::*']
            }]
        };
        await req.object_sdk.put_bucket_policy({ name: req.params.bucket, policy });
    }
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
