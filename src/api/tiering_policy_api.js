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
            auth: {
                system: 'admin'
            }
        },

        get_policy: {
            doc: 'Get Tiering Policy',
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
                tiers: {
                    type: 'array',
                    properties: [{
                        order: {
                            type: Number,
                            required: true,
                        },
                        tier: {
                            type: 'string',
                            required: true,
                        },
                    }]
                }
            }
        }
    }
};
