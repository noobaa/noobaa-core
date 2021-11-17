/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * TIER API
 *
 * client (currently web client) talking to the web server to work on tier
 *
 */
module.exports = {

    $id: 'tier_api',

    methods: {

        create_tier: {
            doc: 'Create tier',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/tier_name' },
                    chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                    data_placement: { $ref: '#/definitions/data_placement_enum' },
                    attached_pools: { $ref: '#/definitions/pool_info' },
                }
            },
            reply: {
                $ref: '#/definitions/tier_info'
            },
            auth: {
                system: 'admin'
            }
        },

        read_tier: {
            doc: 'Read tier info',
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/tier_name' },
                }
            },
            reply: {
                $ref: '#/definitions/tier_info'
            },
            auth: {
                system: 'admin'
            }
        },

        update_tier: {
            doc: 'Update tier info',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/tier_name' },
                    new_name: { $ref: 'common_api#/definitions/tier_name' },
                    chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                    attached_pools: { $ref: '#/definitions/pool_info' },
                    data_placement: { $ref: '#/definitions/data_placement_enum' },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        delete_tier: {
            doc: 'Delete tier',
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/tier_name' },
                }
            },
            auth: {
                system: 'admin'
            }
        },
    },


    definitions: {

        tier_info: {
            type: 'object',
            required: [
                'name',
                'data_placement',
                'storage',
                'data'
            ],
            properties: {
                name: { $ref: 'common_api#/definitions/tier_name' },
                chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                data_placement: { $ref: '#/definitions/data_placement_enum' },
                attached_pools: { $ref: '#/definitions/pool_info' },
                mirror_groups: { $ref: '#/definitions/mirror_groups_info' },
                storage: { $ref: 'common_api#/definitions/storage_info' },
                data: { $ref: 'common_api#/definitions/storage_info' },
            }
        },

        data_placement_enum: {
            enum: ['MIRROR', 'SPREAD'],
            type: 'string',
        },

        pool_info: {
            type: 'array',
            items: {
                type: 'string',
            }
        },

        mirror_groups_info: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    pools: {
                        type: 'array',
                        items: { type: 'string' }
                    }
                }
            }
        }
    }
};
