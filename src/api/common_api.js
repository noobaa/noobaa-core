// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


/**
 *
 * COMMON API
 *
 */
module.exports = rest_api({

    name: 'common_api',

    methods: {},

    definitions: {


        block_info: {
            type: 'object',
            required: ['id', 'node'],
            properties: {
                id: {
                    type: 'string',
                },
                node: {
                    type: 'object',
                    required: ['ip', 'port'],
                    properties: {
                        ip: {
                            type: 'string',
                        },
                        port: {
                            type: 'integer',
                        },
                    }
                }
            }
        },


        storage_info: {
            type: 'object',
            required: ['alloc', 'used'],
            properties: {
                alloc: {
                    $ref: '/common_api/definitions/bigint'
                },
                used: {
                    $ref: '/common_api/definitions/bigint'
                },
                real: {
                    $ref: '/common_api/definitions/bigint'
                },
            }
        },


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
