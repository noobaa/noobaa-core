// this module is written for both nodejs, or for client with browserify.
'use strict';

var restful_api = require('../util/restful_api');


module.exports = restful_api({

    name: 'mgmt_api',

    methods: {

        system_status: {
            method: 'GET',
            path: '/stats',
            reply: {
                type: 'object',
                required: [
                    'allocated_storage',
                    'used_objects_storage',
                    'used_chunks_storage',
                    'total_nodes',
                    'online_nodes'
                ],
                properties: {
                    allocated_storage: {
                        $ref: '/account_api/definitions/bigint'
                    },
                    used_objects_storage: {
                        $ref: '/account_api/definitions/bigint'
                    },
                    used_chunks_storage: {
                        $ref: '/account_api/definitions/bigint'
                    },
                    total_nodes: {
                        type: 'integer',
                    },
                    online_nodes: {
                        type: 'integer',
                    },
                }
            },
        },

    },

});
