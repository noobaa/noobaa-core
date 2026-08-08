/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObjectRetention.html
 *
 * Empty Retention (no Mode / RetainUntilDate) removes object retention when
 * allowed (GOVERNANCE + x-amz-bypass-governance-retention:true).
 */
async function put_object_retention(req) {
    if (!req.body.Retention) throw new S3Error(S3Error.MalformedXML);

    const bypass_governance = req.headers['x-amz-bypass-governance-retention'] &&
        req.headers['x-amz-bypass-governance-retention'].toUpperCase() === 'TRUE';

    // Safe access: Mode/RetainUntilDate may be absent when clearing retention
    const mode = req.body.Retention.Mode && req.body.Retention.Mode[0];
    const retain_until_date_str = req.body.Retention.RetainUntilDate && req.body.Retention.RetainUntilDate[0];

    // Empty Retention clears object retention (AWS / MinIO compatible).
    if (!mode && !retain_until_date_str) {
        await req.object_sdk.put_object_retention({
            bucket: req.params.bucket,
            key: req.params.key,
            version_id: s3_utils.parse_version_id(req.query.versionId),
            bypass_governance,
        });
        return;
    }

    // Partial (only one of Mode or RetainUntilDate) is invalid
    if (!mode || !retain_until_date_str) throw new S3Error(S3Error.MalformedXML);
    const retain_until_date = new Date(retain_until_date_str);

    if (s3_utils._is_valid_retention(mode, retain_until_date)) {
        await req.object_sdk.put_object_retention({
            bucket: req.params.bucket,
            key: req.params.key,
            version_id: s3_utils.parse_version_id(req.query.versionId),
            bypass_governance,
            retention: {
                mode,
                retain_until_date,
            }
        });
    }
}

module.exports = {
    handler: put_object_retention,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
