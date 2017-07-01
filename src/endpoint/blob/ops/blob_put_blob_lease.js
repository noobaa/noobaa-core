/* Copyright (C) 2016 NooBaa */
'use strict';

// const BlobError = require('../blob_errors').BlobError;

function put_blob_lease(req, res) {
    return req.object_sdk.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            // TODO implement put_blob_lease
            // throw new BlobError(BlobError.NotImplemented);
        });
}

module.exports = {
    handler: put_blob_lease,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
