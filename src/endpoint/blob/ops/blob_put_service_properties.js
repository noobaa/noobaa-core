/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/set-blob-service-properties
 */
function put_service_properties(req, res) {
    res.statusCode = 202;
}

module.exports = {
    handler: put_service_properties,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'empty',
    },
};
