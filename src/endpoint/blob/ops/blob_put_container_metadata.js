/* Copyright (C) 2016 NooBaa */
'use strict';

// const BlobError = require('../blob_errors').BlobError;

function put_container_metadata(req, res) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            // TODO implement put_container_metadata
            // throw new BlobError(BlobError.NotImplemented);
        });
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
