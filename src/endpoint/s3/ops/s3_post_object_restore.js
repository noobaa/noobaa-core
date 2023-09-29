/* Copyright (C) 2023 NooBaa */
'use strict';

const { S3Error } = require('../s3_errors');
const s3_utils = require('../s3_utils');
const dbg = require('../../../util/debug_module')(__filename);

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_RestoreObject.html
 */
async function post_object_restore(req, res) {
    const encryption = s3_utils.parse_encryption(req);

    if (!req.body?.RestoreRequest?.Days?.[0]) {
        dbg.warn('post_object_restore: missing Days in body');
        throw new S3Error(S3Error.MalformedXML);
    }

    const days = s3_utils.parse_decimal_int(req.body.RestoreRequest.Days[0]);
    if (days < 1) {
        dbg.warn('post_object_restore: days cannot be less than 1');
        throw new S3Error(S3Error.InvalidArgument);
    }

    const params = {
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: req.query.versionId,
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
