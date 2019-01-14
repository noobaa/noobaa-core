/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadAbort.html
 * AKA Abort Multipart Upload
 */
async function delete_object_uploadId(req) {
    await req.object_sdk.abort_object_upload({
        obj_id: req.query.uploadId,
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
