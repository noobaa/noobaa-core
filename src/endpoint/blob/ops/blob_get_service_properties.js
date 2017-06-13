/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/get-blob-service-properties
 */
function get_service_properties(req, res) {
    return {
        StorageServiceProperties: {}
    };
}

module.exports = {
    handler: get_service_properties,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
