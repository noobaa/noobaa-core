/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/put-block
 */
async function put_blob_block(req, res) {

    const size = Number(req.headers['content-length']);
    // TODO: check content md5? what to do with x-ms-blob-content-md5?
    const reply = await req.object_sdk.upload_blob_block({
        bucket: req.params.bucket,
        key: req.params.key,
        size,
        block_id: req.query.blockid,
        source_stream: req,
    });

    res.setHeader('ETag', `"${reply.etag}"`);
    res.statusCode = 201;
}

module.exports = {
    handler: put_blob_block,
    body: {
        type: 'raw',
    },
    reply: {
        type: 'empty',
    },
};
