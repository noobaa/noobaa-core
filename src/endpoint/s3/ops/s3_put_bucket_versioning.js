/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUTVersioningStatus.html
 */
async function put_bucket_versioning(req) {
    const versioning = req.body.VersioningConfiguration.Status &&
        req.body.VersioningConfiguration.Status[0];
    if (!versioning) return;
    if (versioning !== 'Suspended' && versioning !== 'Enabled') {
        throw new S3Error(S3Error.InvalidArgument);
    }
    await req.object_sdk.set_bucket_versioning({
        name: req.params.bucket,
        versioning: versioning.toUpperCase()
    });
}

module.exports = {
    handler: put_bucket_versioning,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
