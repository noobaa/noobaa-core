/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/get-blob-service-stats
 */
function get_service_stats(req, res) {
    return {
        StorageServiceStats: {
            GeoReplication: {
                Status: 'unavailable',
                LastSyncTime: 'empty',
            }
        }
    };
}

module.exports = {
    handler: get_service_stats,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
