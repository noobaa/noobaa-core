/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUTacl.html
 */
async function put_object_acl(req) {
    if (!req.headers['x-amz-acl']) {
        throw new S3Error(S3Error.AccessDenied);
    }

    await req.object_sdk.put_object_acl({
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: req.query.versionId,
        acl: req.headers['x-amz-acl']
    });
}

module.exports = {
    handler: put_object_acl,
    body: {
        type: 'xml',
        // body is optional since acl info can be provided either in request headers or in the body
        optional: true,
    },
    reply: {
        type: 'empty',
    },
};
