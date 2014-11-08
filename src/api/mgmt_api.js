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
                required: ['allocated_storage', 'used_storage', 'total_nodes', 'online_nodes'],
                properties: {
                    allocated_storage: {
                        $ref: '/edge_node_api/definitions/bigint'
                    },
                    used_storage: {
                        $ref: '/edge_node_api/definitions/bigint'
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

        system_counters: {
            method: 'GET',
            path: '/counters',
            reply: {
                type: 'object',
                required: [
                    'accounts', 'nodes', 'node_vendors',
                    'buckets', 'objects', 'parts', 'chunks', 'blocks'
                ],
                properties: {
                    accounts: {
                        type: 'integer'
                    },
                    nodes: {
                        type: 'integer'
                    },
                    node_vendors: {
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
        },

    },

    ////////////////////////////////
    // general schema definitions //
    ////////////////////////////////

    definitions: {

        bigint: {
            oneOf: [{
                type: 'integer'
            }, {
                type: 'object',
                properties: {
                    n: {
                        type: 'integer',
                    },
                    // to support bigger integers we can specify a peta field
                    // which is considered to be based from 2^50
                    peta: {
                        type: 'integer',
                    }
                }
            }]
        },

    }

});
