'use strict';

/**
 *
 * TIER API
 *
 * client (currently web client) talking to the web server to work on tier
 *
 */
module.exports = {

    name: 'tier_api',

    methods: {

        create_tier: {
            doc: 'Create tier',
            method: 'POST',
            params: {
                type: 'object',
                requires: ['name', 'kind'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    kind: {
                        $ref: '/tier_api/definitions/tier_kind'
                    },
                    edge_details: {
                        $ref: '/tier_api/definitions/edge_details'
                    },
                    cloud_details: {
                        $ref: '/tier_api/definitions/cloud_details'
                    },
                    nodes: {
                        $ref: '/system_api/definitions/nodes_info'
                    },
                    pools: {
                        $ref: '/tier_api/definitions/pool_info'
                    },
                    data_placement: {
                        $ref: '/tier_api/definitions/data_placement_enum'
                    },
                }
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
                $ref: '/tier_api/definitions/tier_info'
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
                    edge_details: {
                        $ref: '/tier_api/definitions/edge_details'
                    },
                    cloud_details: {
                        $ref: '/tier_api/definitions/cloud_details'
                    },
                    nodes: {
                        $ref: '/system_api/definitions/nodes_info'
                    },
                    pools: {
                        $ref: '/tier_api/definitions/pool_info'
                    },
                    data_placement: {
                        $ref: '/tier_api/definitions/data_placement_enum'
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
            required: ['name', 'kind', 'storage', 'nodes', 'pools', 'data_placement'],
            properties: {
                name: {
                    type: 'string',
                },
                kind: {
                    $ref: '/tier_api/definitions/tier_kind'
                },
                edge_details: {
                    $ref: '/tier_api/definitions/edge_details'
                },
                cloud_details: {
                    $ref: '/tier_api/definitions/cloud_details'
                },
                storage: {
                    $ref: '/common_api/definitions/storage_info'
                },
                nodes: {
                    $ref: '/system_api/definitions/nodes_info'
                },
                pools: {
                    $ref: '/tier_api/definitions/pool_info'
                },
                data_placement: {
                    $ref: '/tier_api/definitions/data_placement_enum'
                }
            }
        },

        tier_kind: {
            enum: ['edge', 'cloud'],
            type: 'string',
        },

        edge_details: {
            type: 'object',
            required: ['replicas', 'data_fragments', 'parity_fragments'],
            properties: {
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

        cloud_details: {
            type: 'object',
            // vendor specific properties
            additionalProperties: true,
        },

        data_placement_enum: {
            enum: ['MIRROR', 'SPREAD'],
            type: 'string',
        },

        pools: {
            type: 'array',
            items: {
                type: 'string',
            }
        },
    }
};
