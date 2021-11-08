/* Copyright (C) 2016 NooBaa */
/**
 *
 * AGENT STORE API
 *
 * commands that are sent to an agent (read/write/replicate)
 *
 */
'use strict';

module.exports = {

    $id: 'block_store_api',

    methods: {

        write_block: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['block_md'],
                properties: {
                    // [RPC_BUFFERS].data
                    block_md: {
                        $ref: 'common_api#/definitions/block_md'
                    },
                },
            },
        },

        preallocate_block: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['block_md'],
                properties: {
                    // [RPC_BUFFERS].data
                    block_md: {
                        $ref: 'common_api#/definitions/block_md'
                    },
                },
            },
        },

        verify_blocks: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['verify_blocks'],
                properties: {
                    verify_blocks: {
                        type: 'array',
                        items: {
                            $ref: 'common_api#/definitions/block_md'
                        }
                    }
                },
            },
        },

        handle_delegator_error: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['op_type'],
                properties: {
                    error: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    },
                    usage: { // the usage that was counted for failed operation - need to undo
                        type: 'object',
                        required: ['size', 'count'],
                        properties: {
                            size: {
                                type: 'integer'
                            },
                            count: {
                                type: 'integer'
                            },
                        }
                    },
                    op_type: {
                        type: 'string',
                        enum: ['READ', 'WRITE']
                    }

                }
            }
        },

        delegate_write_block: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['block_md', 'data_length'],
                properties: {
                    block_md: {
                        $ref: 'common_api#/definitions/block_md'
                    },
                    data_length: {
                        type: 'integer'
                    }
                },
            },
            reply: {
                type: 'object',
                additionalProperties: true,
                properties: {}
            }
        },

        delegate_read_block: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['block_md'],
                properties: {
                    block_md: {
                        $ref: 'common_api#/definitions/block_md'
                    },
                },
            },
            reply: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    cached_data: {
                        type: 'object',
                        required: ['block_md'],
                        properties: {
                            block_md: {
                                $ref: 'common_api#/definitions/block_md'
                            },
                            // [RPC_BUFFERS].data
                        },
                    }
                }
            }
        },

        get_block_store_info: {
            method: 'GET',
            reply: {
                type: 'object',
                required: ['connection_params', 'target_bucket', 'blocks_path'],
                properties: {
                    connection_params: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    },
                    target_bucket: {
                        type: 'string'
                    },
                    blocks_path: {
                        type: 'string',
                    },
                    disable_metadata: {
                        type: 'boolean',
                    }
                }
            }
        },

        update_store_usage: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    read_count: { type: 'integer' },
                    read_bytes: { type: 'integer' },
                    write_count: { type: 'integer' },
                    write_bytes: { type: 'integer' },
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
                        $ref: 'common_api#/definitions/block_md'
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['block_md'],
                properties: {
                    // [RPC_BUFFERS].data
                    block_md: {
                        $ref: 'common_api#/definitions/block_md'
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
                        $ref: 'common_api#/definitions/block_md'
                    },
                    source: {
                        $ref: 'common_api#/definitions/block_md'
                    }
                },
            },
        },

        delete_blocks: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['block_ids'],
                properties: {
                    block_ids: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    }
                },
            },
            reply: {
                type: 'object',
                required: ['succeeded_block_ids', 'failed_block_ids'],
                properties: {
                    failed_block_ids: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                    succeeded_block_ids: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    }

                },
            },
        },

    },

};
