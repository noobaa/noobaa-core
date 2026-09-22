/* Copyright (C) 2016 NooBaa */
'use strict';
const s3_utils = require('../s3_utils');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObjectLockConfiguration.html
 */
async function get_bucket_object_lock(req) {
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
