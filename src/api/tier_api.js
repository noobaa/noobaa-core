'use strict';

/**
 *
 * TIER API
 *
 * client (currently web client) talking to the web server to work on tier
 *
 */
module.exports = {

    id: 'tier_api',

    methods: {

        create_tier: {
            doc: 'Create tier',
            method: 'POST',
            params: {
                type: 'object',
                requires: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    pools: {
                        $ref: '#/definitions/pool_info'
                    },
                    data_placement: {
                        $ref: '#/definitions/data_placement_enum'
                    },
                    replicas: {
                        type: 'integer',
                    },
                    data_fragments: {
                        type: 'integer',
                    },
                    parity_fragments: {
                        type: 'integer',
                    },
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
                requires: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
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
                requires: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    new_name: {
                        type: 'string',
                    },
                    pools: {
                        $ref: '#/definitions/pool_info'
                    },
                    data_placement: {
                        $ref: '#/definitions/data_placement_enum'
                    },
                    replicas: {
                        type: 'integer',
                    },
                    data_fragments: {
                        type: 'integer',
                    },
                    parity_fragments: {
                        type: 'integer',
                    },
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
                requires: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
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
                'pools',
                'data_placement',
                'replicas',
                'data_fragments',
                'parity_fragments',
                'storage',
            ],
            properties: {
                name: {
                    type: 'string',
                },
                pools: {
                    $ref: '#/definitions/pool_info'
                },
                data_placement: {
                    $ref: '#/definitions/data_placement_enum'
                },
                replicas: {
                    type: 'integer',
                },
                data_fragments: {
                    type: 'integer',
                },
                parity_fragments: {
                    type: 'integer',
                },
                storage: {
                    $ref: 'common_api#/definitions/storage_info'
                },
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
    }
};
