/* Copyright (C) 2016 NooBaa */
'use strict';
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const config = require('../../../../config');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObjectRetention.html
 */
async function put_object_retention(req) {
    if (!config.WORM_ENABLED) {
        throw new S3Error(S3Error.NotImplemented);
    }
    // TODO: may require at the future Content-MD5 support
    if (!req.body.Retention) throw new S3Error(S3Error.MalformedXML);
    const mode = req.body.Retention.Mode[0];
    let retain_until_date = req.body.Retention.RetainUntilDate[0];
    if (!mode && !retain_until_date) throw new S3Error(S3Error.AccessDenied);
    if (!mode || !retain_until_date) throw new S3Error(S3Error.MalformedXML);
    retain_until_date = new Date(req.body.Retention.RetainUntilDate[0]);

    let bypass_governance = req.headers['x-amz-bypass-governance-retention'] && req.headers['x-amz-bypass-governance-retention'].toUpperCase() === 'TRUE';

    if (s3_utils._is_valid_retention(mode, retain_until_date)) {
        await req.object_sdk.put_object_retention({
            bucket: req.params.bucket,
            key: req.params.key,
            version_id: req.query.versionId,
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
