/* Copyright (C) 2016 NooBaa */
'use strict';

const BlobError = require('../blob_errors').BlobError;
const blob_utils = require('../blob_utils');
const http_utils = require('../../../util/http_utils');

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/put-blob
 */
function put_blob(req, res) {
    if (req.headers['x-ms-copy-source']) throw new BlobError(BlobError.NotImplemented);

    return req.object_io.upload_object({
            client: req.rpc_client,
            bucket: req.params.bucket,
            key: req.params.key,
            content_type: req.headers['x-ms-blob-content-type'],
            size: req.content_length >= 0 ? req.content_length : undefined,
            md5_b64: req.content_md5 ? req.content_md5.toString('base64') : undefined,
            sha256_b64: req.content_sha256_buf ? req.content_sha256_buf.toString('base64') : undefined,
            md_conditions: http_utils.get_md_conditions(req),
            xattr: blob_utils.get_request_xattr(req),
            source_stream: req,
        })
        .then(reply => {
            res.setHeader('ETag', `"${reply.etag}"`);
            res.statusCode = 201;
        });
}

module.exports = {
    handler: put_blob,
    body: {
        type: 'raw',
    },
    reply: {
        type: 'empty',
    },
};
