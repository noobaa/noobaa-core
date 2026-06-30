/* Copyright (C) 2016 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');
const S3Error = require('../s3_errors').S3Error;
const config = require('../../../../config');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObjectRetention.html
 */
async function get_object_retention(req) {
    if (!config.WORM_ENABLED) {
        throw new S3Error(S3Error.NotImplemented);
    }
    const object_retention = await req.object_sdk.get_object_retention({
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: s3_utils.parse_version_id(req.query.versionId)
    });

    if (object_retention.retention && object_retention.retention.retain_until_date) {
        object_retention.retention.retain_until_date = new Date(object_retention.retention.retain_until_date).toISOString();
    }
    const parsed = s3_utils.parse_to_camel_case(object_retention);
    return parsed;
}

module.exports = {
    handler: get_object_retention,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
