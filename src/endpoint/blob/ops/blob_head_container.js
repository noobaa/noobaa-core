/* Copyright (C) 2016 NooBaa */
'use strict';

// const BlobError = require('../blob_errors').BlobError;

function head_container(req, res) {
    return req.rpc_client.bucket.read_bucket({
            name: req.params.bucket
        })
        .then(bucket_info => {
            res.setHeader('x-ms-lease-status', 'unlocked');
            res.setHeader('x-ms-lease-state', 'available');
        });
}

module.exports = {
    handler: head_container,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
