/* Copyright (C) 2016 NooBaa */
'use strict';

const blob_utils = require('../blob_utils');
const http_utils = require('../../../util/http_utils');
const time_utils = require('../../../util/time_utils');
const mime = require('mime');


/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/put-blob
 */
async function put_blob(req, res) {
    let copy_source = blob_utils.parse_copy_source(req);

    const { etag } = await req.object_sdk.upload_object({
        bucket: req.params.bucket,
        key: req.params.key,
        content_type: req.headers['x-ms-blob-content-type'] || (copy_source ? undefined : (mime.getType(req.params.key) || 'application/octet-stream')),
        size: req.content_length >= 0 ? req.content_length : undefined,
        md5_b64: req.content_md5 ? req.content_md5.toString('base64') : undefined,
        sha256_b64: req.content_sha256_buf ? req.content_sha256_buf.toString('base64') : undefined,
        md_conditions: http_utils.get_md_conditions(req),
        xattr: blob_utils.get_request_xattr(req),
        source_stream: req,
        copy_source
    });

    if (req.headers['x-ms-copy-source']) {
        res.setHeader('Last-Modified', time_utils.format_http_header_date(new Date()));
        // TODO: this should not be hard coded 'success'. the copy operation could be
        // passed to azure if the target bucket is namespace on azure, and the operations
        // could be pending there
        res.setHeader('x-ms-copy-status', 'success');
        // TODO: for now we return the etag as the copy id. should be replaced with a key that 
        // we can search the object object by
        res.setHeader('x-ms-copy-id', etag);
        // for copy blob return 202
        res.statusCode = 202;
    } else {
        res.setHeader('ETag', `"${etag}"`);
        res.statusCode = 201;
    }
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
