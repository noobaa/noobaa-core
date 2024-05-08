/* Copyright (C) 2023 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_RestoreObject.html
 */
async function post_object_restore(req, res) {
    const encryption = s3_utils.parse_encryption(req);

    const days = s3_utils.parse_restore_request_days(req);
    const params = {
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: s3_utils.parse_version_id(req.query.versionId),
        days,
        encryption,
    };

    const accepted = await req.object_sdk.restore_object(params);
    if (accepted) {
        res.statusCode = 202;
    } else {
        res.statusCode = 200;
    }
}

module.exports = {
    handler: post_object_restore,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
