/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/mpUploadAbort.html
 * AKA Abort Multipart Upload
 */
function delete_object_uploadId(req) {
    return req.rpc_client.object.abort_object_upload({
        bucket: req.params.bucket,
        key: req.params.key,
        upload_id: req.query.uploadId,
    }).return();
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
