/**
 *
 * AGENT STORE API
 *
 * commands that are sent to an agent (read/write/replicate)
 *
 */
'use strict';

module.exports = {

    id: 'block_store_api',

    methods: {

        write_block: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['block_md', 'data'],
                properties: {
                    block_md: {
                        $ref: 'common_api#/definitions/block_md'
                    },
                    data: {
                        buffer: true
                    },
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
                required: ['block_md', 'data'],
                properties: {
                    block_md: {
                        $ref: 'common_api#/definitions/block_md'
                    },
                    data: {
                        buffer: true
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
        },

    },

};
