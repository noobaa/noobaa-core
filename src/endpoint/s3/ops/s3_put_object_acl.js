/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPUTacl.html
 */
function put_object_acl(req) {
    const read_md_params = {
        bucket: req.params.bucket,
        key: req.params.key,
    };
    if ('versionId' in req.query) {
        read_md_params.version_id = req.query.versionId === 'null' ? null : req.query.versionId;
    }
    return req.object_sdk.read_object_md(read_md_params)
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
