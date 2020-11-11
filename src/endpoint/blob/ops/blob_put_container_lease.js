/* Copyright (C) 2016 NooBaa */
'use strict';

// const BlobError = require('../blob_errors').BlobError;

async function put_container_lease(req, res) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    // TODO implement put_container_lease
    // throw new BlobError(BlobError.NotImplemented);

    const action = req.headers['x-ms-lease-action'];
    const LEASE_ACTION_STATUS_CODE = {
        acquire: 201,
        renew: 200,
        change: 200,
        release: 200,
        break: 202,
    };
    res.statusCode = LEASE_ACTION_STATUS_CODE[action];
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
