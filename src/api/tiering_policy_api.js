/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * TIERING POLICY API
 *
 *
 */
module.exports = {

    $id: 'tiering_policy_api',

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

        update_bucket_class: {
            doc: 'Update Bucket Class',
            method: 'POST',
            params: {
                $ref: '#/definitions/bucket_class_policy'
            },
            reply: {
                type: 'object',
                required: ['error_message', 'should_revert', 'revert_to_policy'],
                properties: {
                    error_message: {
                        type: 'string'
                    },
                    should_revert: {
                        type: 'boolean'
                    },
                    revert_to_policy: {
                        $ref: '#/definitions/bucket_class_policy'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        add_tier_to_bucket: {
            doc: 'Adding Tier to Tiering Policy',
            method: 'POST',
            params: {
                type: 'object',
                required: ['bucket_name', 'tier'],
                properties: {
                    bucket_name: {
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
            auth: {
                system: 'admin'
            }
        },

        update_chunk_config_for_bucket: {
            doc: 'Updating the chunk code config for all the tiers in a Tiering Policy',
            method: 'POST',
            params: {
                type: 'object',
                required: ['bucket_name', 'chunk_coder_config'],
                properties: {
                    bucket_name: {
                        type: 'string'
                    },
                    chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                }
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
                    name: { $ref: 'common_api#/definitions/tiering_name' },
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
                    name: { $ref: 'common_api#/definitions/tiering_name' },
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
                    name: { $ref: 'common_api#/definitions/tiering_name' },
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
                name: { $ref: 'common_api#/definitions/tiering_name' },
                data: { $ref: 'common_api#/definitions/storage_info' },
                storage: { $ref: 'common_api#/definitions/storage_info' },
                chunk_split_config: { $ref: 'common_api#/definitions/chunk_split_config' },
                tiers: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/tier_item'
                    },
                },
                mode: { $ref: 'common_api#/definitions/bucket_mode' }
            }
        },
        bucket_class_policy: {
            type: 'object',
            required: ['name', 'policy', 'tiers'],
            properties: {
                name: {
                    type: 'string'
                },
                policy: {
                    $ref: '#/definitions/tiering_policy'
                },
                tiers: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['name'],
                        properties: {
                            name: { $ref: 'common_api#/definitions/tier_name' },
                            chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                            data_placement: { $ref: 'tier_api#/definitions/data_placement_enum' },
                            attached_pools: { $ref: 'tier_api#/definitions/pool_info' },
                        }
                    }
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
                tier: { $ref: 'common_api#/definitions/tier_name' },
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
                'NO_RESOURCES',
                'NOT_ENOUGH_RESOURCES',
                'NOT_ENOUGH_HEALTHY_RESOURCES',
                'INTERNAL_STORAGE_ISSUES',
                'NO_CAPACITY',
                'LOW_CAPACITY',
                'OPTIMAL'
            ]
        },
    },
};
