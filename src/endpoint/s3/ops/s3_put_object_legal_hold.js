/* Copyright (C) 2016 NooBaa */
'use strict';
const S3Error = require('../s3_errors').S3Error;
const config = require('../../../../config');


/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObjectLegalHold.html
 */
async function put_object_legal_hold(req) {
    if (!config.WORM_ENABLED) {
        throw new S3Error(S3Error.NotImplemented);
    }
    // TODO: may require at the future Content-MD5 support
    const legal_hold_status = req.body.LegalHold.Status[0];
    if (legal_hold_status !== 'ON' && legal_hold_status !== 'OFF') {
        throw new S3Error(S3Error.MalformedXML);
    }
    await req.object_sdk.put_object_legal_hold({
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: req.query.versionId,
        legal_hold: { status: legal_hold_status }
    });
}

module.exports = {
    handler: put_object_legal_hold,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
