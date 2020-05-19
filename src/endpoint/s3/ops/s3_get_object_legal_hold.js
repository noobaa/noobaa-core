/* Copyright (C) 2016 NooBaa */
'use strict';
const s3_utils = require('../s3_utils');
const S3Error = require('../s3_errors').S3Error;
const config = require('../../../../config');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObjectLegalHold.html
 */
async function get_object_legal_hold(req, res) {
    if (!config.WORM_ENABLED) {
        throw new S3Error(S3Error.NotImplemented);
    }
    const object_legal_hold = await req.object_sdk.get_object_legal_hold({
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: req.query.versionId
    });
    const parsed = s3_utils.parse_to_camel_case(object_legal_hold);
    return parsed;
}
module.exports = {
    handler: get_object_legal_hold,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
