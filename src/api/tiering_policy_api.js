'use strict';

/**
 *
 * TIERING POLICY API
 *
 *
 */
module.exports = {
    name: 'tiering_policy_api',

    methods: {
        create_policy: {
            doc: 'Create Tiering Policy',
            method: 'POST',
            params: {
                type: 'object',
                required: ['policy'],
                properties: {
                    policy: {
                        $ref: '/tiering_policy_api/definitions/tiering_policy'
                    }
                }
            },
            reply: {
                $ref: '/tiering_policy_api/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
        },

        update_policy: {
            doc: 'Update Tiering Policy',
            method: 'POST',
            params: {
                type: 'object',
                required: ['policy'],
                properties: {
                    policy: {
                        $ref: '/tiering_policy_api/definitions/tiering_policy'
                    }
                }
            },
            reply: {
                $ref: '/tiering_policy_api/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
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
                $ref: '/tiering_policy_api/definitions/tiering_policy'
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
                $ref: '/tiering_policy_api/definitions/tiering_policy'
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
                name: {
                    type: 'string',
                },
                storage: {
                    $ref: '/common_api/definitions/storage_info'
                },                
                tiers: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['order', 'tier'],
                        properties: {
                            order: {
                                type: 'integer',
                            },
                            tier: {
                                type: 'string',
                            },
                        }
                    }
                }
            }
        }
    },
};
