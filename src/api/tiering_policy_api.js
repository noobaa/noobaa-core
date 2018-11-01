/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * TIERING POLICY API
 *
 *
 */
module.exports = {

    id: 'tiering_policy_api',

    methods: {

        create_policy: {
            doc: 'Create Tiering Policy',
            method: 'POST',
            params: {
                $ref: '#/definitions/tiering_policy'
            },
            reply: {
                $ref: '#/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
        },

        update_policy: {
            doc: 'Update Tiering Policy',
            method: 'POST',
            params: {
                $ref: '#/definitions/tiering_policy'
            },
            reply: {
                $ref: '#/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
        },

        add_tier_to_policy: {
            doc: 'Adding Tier to Tiering Policy',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'tier'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    tier: {
                        type: 'object',
                        properties: {
                            chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                            data_placement: { $ref: 'tier_api#/definitions/data_placement_enum' },
                            attached_pools: { $ref: 'tier_api#/definitions/pool_info' },
                            order: { type: 'integer' },
                        }
                    }
                }
            },
            reply: {
                $ref: '#/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
        },

        update_chunk_config_for_policy: {
            doc: 'Updating the chunk code config for all the tiers in a Tiering Policy',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'chunk_coder_config'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                }
            },
            reply: {
                $ref: '#/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            },
        },

        read_policy: {
            doc: 'Read Tiering Policy',
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            reply: {
                $ref: '#/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
        },

        get_policy_pools: {
            doc: 'Get Tiering Policy Pools',
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            reply: {
                $ref: '#/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
        },

        delete_policy: {
            doc: 'Delete Tiering Policy',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        }
    },

    definitions: {

        tiering_policy: {
            type: 'object',
            required: ['name', 'tiers'],
            properties: {
                name: { type: 'string' },
                data: { $ref: 'common_api#/definitions/storage_info' },
                storage: { $ref: 'common_api#/definitions/storage_info' },
                chunk_split_config: { $ref: 'common_api#/definitions/chunk_split_config' },
                tiers: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/tier_item'
                    },
                }
            }
        },
        tier_item: {
            type: 'object',
            required: ['order', 'tier'],
            properties: {
                order: {
                    type: 'integer',
                },
                tier: {
                    type: 'string',
                },
                spillover: {
                    type: 'boolean'
                },
                disabled: {
                    type: 'boolean'
                },
                mode: { $ref: '#/definitions/tier_placement_status' }
            },
        },
        tier_placement_status: {
            type: 'string',
            enum: [
                'INTERNAL_ISSUES',
                'NO_RESOURCES',
                'NOT_ENOUGH_RESOURCES',
                'NOT_ENOUGH_HEALTHY_RESOURCES',
                'NO_CAPACITY',
                'RISKY_TOLERANCE',
                'LOW_CAPACITY',
                'DATA_ACTIVITY',
                'OPTIMAL'
            ]
        },
    },
};
