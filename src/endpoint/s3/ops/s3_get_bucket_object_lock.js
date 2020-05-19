/* Copyright (C) 2016 NooBaa */
'use strict';
const s3_utils = require('../s3_utils');
const config = require('../../../../config');
const S3Error = require('../s3_errors').S3Error;

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObjectLockConfiguration.html
 */
async function get_bucket_object_lock(req) {
    if (!config.WORM_ENABLED) {
        throw new S3Error(S3Error.NotImplemented);
    }
    const object_lock_configuration = await req.object_sdk.get_object_lock_configuration({ name: req.params.bucket });
    const parsed = s3_utils.parse_to_camel_case(object_lock_configuration, 'ObjectLockConfiguration');
    return parsed;
}

module.exports = {
    handler: get_bucket_object_lock,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
