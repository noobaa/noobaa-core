// this module is written for both nodejs, or for client with browserify.
'use strict';

var restful_api = require('../util/restful_api');


module.exports = restful_api({

    name: 'mgmt_api',

    methods: {

        system_stats: {
            method: 'GET',
            path: '/stats',
            reply: {
                type: 'object',
                required: ['allocated_storage', 'used_storage', 'counters'],
                properties: {
                    allocated_storage: {
                        $ref: '/edge_node_api/definitions/storage_size'
                    },
                    used_storage: {
                        $ref: '/edge_node_api/definitions/storage_size'
                    },
                    counters: {
                        type: 'object',
                        required: [
                            'accounts', 'nodes',
                            'buckets', 'objects',
                            'parts', 'chunks', 'blocks'
                        ],
                        properties: {
                            accounts: {
                                type: 'integer'
                            },
                            nodes: {
                                type: 'integer'
                            },
                            buckets: {
                                type: 'integer'
                            },
                            objects: {
                                type: 'integer'
                            },
                            parts: {
                                type: 'integer'
                            },
                            chunks: {
                                type: 'integer'
                            },
                            blocks: {
                                type: 'integer'
                            },
                        }
                    },
                }
            },
        },


    }

});
