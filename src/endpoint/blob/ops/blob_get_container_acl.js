/* Copyright (C) 2016 NooBaa */
'use strict';

// const BlobError = require('../blob_errors').BlobError;

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/get-container-acl
 */
async function get_container_acl(req, res) {
    await req.object_sdk.read_bucket({ name: req.params.bucket });
    return { SignedIdentifiers: {} };
}

module.exports = {
    handler: get_container_acl,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
