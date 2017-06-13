/* Copyright (C) 2016 NooBaa */
'use strict';

// const BlobError = require('../blob_errors').BlobError;

function get_container_acl(req, res) {
    return {
        SignedIdentifiers: {}
    };
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
