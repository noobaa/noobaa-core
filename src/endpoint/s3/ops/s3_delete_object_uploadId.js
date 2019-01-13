/* Copyright (C) 2016 NooBaa */
'use strict';

const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadAbort.html
 * AKA Abort Multipart Upload
 */
async function delete_object_uploadId(req) {
    const upload_id = req.query.uploadId;
    const object_id_regex = RegExp(/^[0-9a-fA-F]{24}$/);

    if (!upload_id || !object_id_regex.test(upload_id)) throw new S3Error(S3Error.NoSuchUpload);

    await req.object_sdk.abort_object_upload({
        obj_id: upload_id,
        bucket: req.params.bucket,
        key: req.params.key,
    });
}

module.exports = {
    handler: delete_object_uploadId,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
