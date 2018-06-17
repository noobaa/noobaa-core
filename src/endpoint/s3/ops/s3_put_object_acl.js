/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUTacl.html
 */
function put_object_acl(req) {
    return req.object_sdk.read_object_md({
            bucket: req.params.bucket,
            key: req.params.key,
            version_id: req.query.versionId,
        })
        .then(object_md => {
            // TODO S3 ignoring put_object_acl for now
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
