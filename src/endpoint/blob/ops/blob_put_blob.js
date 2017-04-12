/* Copyright (C) 2016 NooBaa */
'use strict';

const BlobError = require('../blob_errors').BlobError;

function put_blob(req, res) {
    if (req.headers['x-ms-copy-source']) throw new BlobError(BlobError.NotImplemented);

    let params = {
        client: req.rpc_client,
        bucket: req.params.bucket,
        key: req.params.key,
        content_type: req.headers['x-ms-blob-content-type'],
        // xattr: get_request_xattr(req),
        source_stream: req,
    };
    if (req.content_length >= 0) params.size = req.content_length;
    if (req.content_md5) params.md5_b64 = req.content_md5.toString('base64');
    if (req.content_sha256) params.sha256_b64 = req.content_sha256.toString('base64');
    // this._set_md_conditions(req, params, 'overwrite_if');
    return req.object_io.upload_object(params)
        .then(reply => {
            res.setHeader('ETag', '"' + reply.etag + '"');
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
