// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


module.exports = rest_api({

    name: 'system_api',

    methods: {

        /*
        create_system: {
            method: 'POST',
            path: '/system',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                },
            },
        },
        */

        get_stats: {
            method: 'GET',
            path: '/stats',
            params: {
                type: 'object',
                required: [],
                properties: {
                    system_stats: {
                        type: 'boolean'
                    }
                }
            },
            reply: {
                type: 'object',
                required: [
                    'allocated_storage',
                    'used_storage',
                    'chunks_storage',
                    'nodes',
                    'online_nodes',
                    'node_vendors',
                    'buckets',
                    'objects',
                ],
                properties: {
                    allocated_storage: {
                        $ref: '/system_api/definitions/bigint'
                    },
                    used_storage: {
                        $ref: '/system_api/definitions/bigint'
                    },
                    chunks_storage: {
                        $ref: '/system_api/definitions/bigint'
                    },
                    nodes: {
                        type: 'integer'
                    },
                    online_nodes: {
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
