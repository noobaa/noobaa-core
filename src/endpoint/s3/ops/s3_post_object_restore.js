/* Copyright (C) 2023 NooBaa */
'use strict';

const s3_utils = require('../s3_utils');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_RestoreObject.html
 */
async function post_object_restore(req, res) {
    const encryption = s3_utils.parse_encryption(req);
    const days = req.body?.RestoreRequest?.Days ? parseInt(req.body.RestoreRequest.Days?.[0], 10) : undefined;
    const params = {
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: req.query.versionId,
        days: days,
        encryption,
    };


    await req.object_sdk.restore_object(params);
    res.statusCode = 200;
}

module.exports = {
    handler: post_object_restore,
    body: {
        type: 'xml',
        optional: true
    },
    reply: {
        type: 'empty',
    },
};
