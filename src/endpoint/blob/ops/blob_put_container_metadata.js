/* Copyright (C) 2016 NooBaa */
'use strict';

// const BlobError = require('../blob_errors').BlobError;

async function put_container_metadata(req, res) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    // TODO implement put_container_metadata
    // throw new BlobError(BlobError.NotImplemented);
}

module.exports = {
    handler: put_container_metadata,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
