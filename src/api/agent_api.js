// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


/**
 *
 * AGENT API
 *
 */
module.exports = rest_api({

    name: 'agent_api',

    methods: {

        write_block: {
            method: 'POST',
            path: '/block/:block_id',
            param_raw: 'data',
            params: {
                type: 'object',
                required: ['block_id'],
                properties: {
                    block_id: {
                        type: 'string',
                    },
                },
            },
        },

        read_block: {
            method: 'GET',
            path: '/block/:block_id',
            params: {
                type: 'object',
                required: ['block_id'],
                properties: {
                    block_id: {
                        type: 'string',
                    },
                },
            },
            reply_raw: true,
        },


        replicate_block: {
            method: 'POST',
            path: '/block/:block_id/replicate',
            params: {
                type: 'object',
                required: ['block_id'],
                properties: {
                    block_id: {
                        type: 'string',
                    },
                    source: {
                        $ref: '/common_api/definitions/block_info'
                    }
                },
            },
        },


        check_block: {
            method: 'POST',
            path: '/block/:block_id/check',
            params: {
                type: 'object',
                required: ['block_id', 'slices'],
                properties: {
                    block_id: {
                        type: 'string',
                    },
                    slices: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['start', 'end'],
                            properties: {
                                start: {
                                    type: 'integer'
                                },
                                end: {
                                    type: 'integer'
                                },
                            }
                        }
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['checksum'],
                properties: {
                    checksum: {
                        type: 'string',
                    },
                },
            },
        },

        delete_block: {
            method: 'DELETE',
            path: '/block/:block_id',
            params: {
                type: 'object',
                required: ['block_id'],
                properties: {
                    block_id: {
                        type: 'string',
                    },
                },
            },
        },

        kill_agent: {
            method: 'POST',
            path: '/kill',
        },

    }

});
