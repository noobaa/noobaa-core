/* Copyright (C) 2016 NooBaa */
'use strict';

// const BlobError = require('../blob_errors').BlobError;

function put_container_lease(req, res) {
    return req.rpc_client.bucket.read_bucket({ name: req.params.bucket })
        .then(bucket_info => {
            // TODO implement put_container_lease
            // throw new BlobError(BlobError.NotImplemented);
        });
}

module.exports = {
    handler: put_container_lease,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
