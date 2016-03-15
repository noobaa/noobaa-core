'use strict';

/**
 *
 * AGENT API
 *
 * commands that are sent to an agent (read/write/replicate)
 *
 */
module.exports = {

    id: 'agent_api',

    methods: {

        write_block: {
            method: 'POST',
            param_raw: 'data',
            params: {
                type: 'object',
                required: ['block_md', 'data'],
                properties: {
                    block_md: {
                        $ref: '#/definitions/block_md'
                    },
                    data: {
                        format: 'buffer'
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
                        $ref: '#/definitions/block_md'
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['block_md', 'data'],
                properties: {
                    block_md: {
                        $ref: '#/definitions/block_md'
                    },
                    data: {
                        format: 'buffer'
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
                        $ref: '#/definitions/block_md'
                    },
                    source: {
                        $ref: '#/definitions/block_md'
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
                            type: 'string'
                        }
                    }
                },
            },
        },

        n2n_signal: {
            method: 'POST',
            params: {
                $ref: 'node_api#/definitions/signal_params'
            },
            reply: {
                $ref: 'node_api#/definitions/signal_reply'
            },
        },

        self_test_io: {
            method: 'POST',
            param_raw: 'data',
            params: {
                type: 'object',
                required: ['source', 'target', 'response_length'],
                properties: {
                    source: {
                        type: 'string'
                    },
                    target: {
                        type: 'string'
                    },
                    response_length: {
                        type: 'integer'
                    },
                    data: {
                        format: 'buffer'
                    }
                },
            },
            reply: {
                type: 'object',
                required: ['data'],
                properties: {
                    data: {
                        format: 'buffer'
                    },
                },
            },
        },

        self_test_peer: {
            method: 'POST',
            params: {
                $ref: '#/definitions/self_test_params'
            },
            reply: {
                $ref: '#/definitions/self_test_reply'
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
                        format: 'buffer'
                    },
                },
            },
        },

        set_debug_node: {
            method: 'POST',
        },

        update_n2n_config: {
            method: 'POST',
            params: {
                $ref: 'common_api#/definitions/n2n_config'
            }
        },

        update_base_address: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['base_address'],
                properties: {
                    base_address: {
                        type: 'string'
                    }
                }
            }
        }

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
                node: {
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

        self_test_params: {
            type: 'object',
            required: [
                'source',
                'target',
                'request_length',
                'response_length',
                'count',
                'concur',
            ],
            properties: {
                source: {
                    type: 'string',
                },
                target: {
                    type: 'string',
                },
                request_length: {
                    type: 'integer',
                },
                response_length: {
                    type: 'integer',
                },
                count: {
                    type: 'integer',
                },
                concur: {
                    type: 'integer',
                }
            }
        },

        self_test_reply: {
            type: 'object',
            properties: {
                session: {
                    type: 'string',
                }
            }
        },

    }

};
