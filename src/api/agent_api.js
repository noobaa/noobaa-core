'use strict';

/**
 *
 * AGENT API
 *
 * commands that are sent to an agent (read/write/replicate)
 *
 */
module.exports = {

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
                        $ref: '/common_api/definitions/block_address'
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

        self_test_io: {
            method: 'POST',
            path: '/self_test/io',
            param_raw: 'data',
            params: {
                type: 'object',
                required: ['response_length'],
                properties: {
                    response_length: {
                        type: 'integer'
                    }
                },
            },
            reply_raw: true,
        },

        self_test_peer: {
            method: 'POST',
            path: '/self_test/peer',
            params: {
                type: 'object',
                required: ['target', 'request_length', 'response_length'],
                properties: {
                    target: {
                        $ref: '/common_api/definitions/block_address'
                    },
                    request_length: {
                        type: 'integer'
                    },
                    response_length: {
                        type: 'integer'
                    }
                },
            },
        },

        kill_agent: {
            method: 'POST',
            path: '/kill',
        },

    }

};
