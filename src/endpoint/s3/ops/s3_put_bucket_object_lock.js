/* Copyright (C) 2016 NooBaa */
'use strict';
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const config = require('../../../../config');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObjectLockConfiguration.html
 */
async function put_bucket_object_lock(req, res) {
    if (!config.WORM_ENABLED) {
        throw new S3Error(S3Error.NotImplemented);
    }
    // TODO: may require at the future Content-MD5 & bucket-object-lock-token support
    if (req.body.ObjectLockConfiguration.ObjectLockEnabled[0] !== 'Enabled') {
        throw new S3Error(S3Error.MalformedXML);
    }
    const lock_configuration = s3_utils.parse_body_object_lock_conf_xml(req);

    try {
        await req.object_sdk.put_object_lock_configuration({
            name: req.params.bucket,
            object_lock_configuration: lock_configuration,
        });
    } catch (err) {
        let error = err;
        if (err.rpc_code === 'INVALID_SCHEMA' || err.rpc_code === 'INVALID_SCHEMA_PARAMS') {
            console.error('put_bucket_object_lock: Invalid schema provided', err);
            error = new S3Error(S3Error.MalformedXML);
        }
        throw error;
    }
}

module.exports = {
    handler: put_bucket_object_lock,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
