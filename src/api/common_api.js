'use strict';

/**
 *
 * COMMON API
 *
 * general defenitions used by other api's
 *
 */
module.exports = {

    name: 'common_api',

    methods: {},

    definitions: {


        block_address: {
            type: 'object',
            required: ['id'],
            properties: {
                id: {
                    type: 'string'
                },
                peer: {
                    type: 'string'
                },
                addresses: {
                    type: 'array',
                    items: {
                        type: 'string'
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
};
