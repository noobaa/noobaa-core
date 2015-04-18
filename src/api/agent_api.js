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
            param_raw: 'data',
            params: {
                type: 'object',
                required: ['block_id', 'data'],
                properties: {
                    block_id: {
                        type: 'string',
                    },
                    data: {
                        type: 'object',
                        format: 'buffer'
                    }
                },
            },
        },

        read_block: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['block_id'],
                properties: {
                    block_id: {
                        type: 'string',
                    },
                },
            },
            reply: {
                type: 'object',
                format: 'buffer'
            },
            reply_raw: true,
        },


        replicate_block: {
            method: 'POST',
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

        delete_blocks: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['blocks'],
                properties: {
                    blocks: {
                        type: 'array',
                        ids: {
                            type: 'object',
                            required: ['id'],
                            properties: {
                                id: {
                                    type: 'string'
                                }
                            }
                        }
                    }
                },
            },
        },


        self_test_io: {
            method: 'POST',
            param_raw: 'data',
            params: {
                type: 'object',
                required: ['response_length'],
                properties: {
                    response_length: {
                        type: 'integer'
                    },
                    data: {
                        type: 'object',
                        format: 'buffer'
                    }
                },
            },
            reply: {
                type: 'object',
                format: 'buffer'
            },
            reply_raw: true,
        },

        self_test_peer: {
            method: 'POST',
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
        },

    }

};
