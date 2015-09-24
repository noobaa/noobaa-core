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
                required: ['block_md', 'data'],
                properties: {
                    block_md: {
                        $ref: '/agent_api/definitions/block_md'
                    },
                    data: {
                        type: 'buffer'
                    }
                },
            },
        },

        read_block: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['block_md'],
                properties: {
                    block_md: {
                        $ref: '/agent_api/definitions/block_md'
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['block_md', 'data'],
                properties: {
                    block_md: {
                        $ref: '/agent_api/definitions/block_md'
                    },
                    data: {
                        type: 'buffer'
                    },
                },
            },
        },


        replicate_block: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['target', 'source'],
                properties: {
                    target: {
                        $ref: '/agent_api/definitions/block_md'
                    },
                    source: {
                        $ref: '/agent_api/definitions/block_md'
                    }
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
                        items: {
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

        n2n_signal: {
            method: 'POST',
            params: {
                $ref: '/node_api/definitions/signal_params'
            },
            reply: {
                $ref: '/node_api/definitions/signal_reply'
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
                        type: 'buffer'
                    }
                },
            },
            reply: {
                type: 'object',
                required: ['data'],
                properties: {
                    data: {
                        type: 'buffer'
                    },
                },
            },
        },

        self_test_peer: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['target', 'request_length', 'response_length'],
                properties: {
                    target: {
                        type: 'string'
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

        collect_diagnostics: {
            method: 'GET',
            reply: {
                type: 'object',
                required: ['data'],
                properties: {
                    data: {
                        type: 'buffer'
                    },
                },
            },
        },

        set_debug_node: {
            method: 'POST',
        },

    },

    definitions: {

        block_md: {
            type: 'object',
            required: ['id'],
            properties: {
                id: {
                    type: 'string'
                },
                address: {
                    type: 'string'
                },
                size: {
                    type: 'integer'
                },
                digest_type: {
                    type: 'string'
                },
                digest_b64: {
                    type: 'string'
                },
            }
        },

    }

};
