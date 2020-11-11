/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTacl.html
 */
async function put_bucket_acl(req) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    // TODO S3 put_bucket_acl not implemented
    // we do not throw here and just ignore since it is common for applications to call this api
}

module.exports = {
    handler: put_bucket_acl,
    body: {
        type: 'xml',
        // body is optional since acl info can be provided either in request headers or in the body
        optional: true,
    },
    reply: {
        type: 'empty',
    },
};
