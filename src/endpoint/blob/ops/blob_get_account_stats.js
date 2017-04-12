/* Copyright (C) 2016 NooBaa */
'use strict';

function get_account_properties(req, res) {
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
    handler: get_account_properties,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
