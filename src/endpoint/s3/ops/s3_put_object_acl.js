/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUTacl.html
 */
async function put_object_acl(req) {
    // we only handle canned acl, the rest is deprecated in favor of bucket policy.
    // however we do not fail the request because there are still clients that call it.
    // we should still check that the object exists or else return the proper error.
    await req.object_sdk.put_object_acl({
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: s3_utils.parse_version_id(req.query.versionId),
        acl: req.headers['x-amz-acl'],
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
