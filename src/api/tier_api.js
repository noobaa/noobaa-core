// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


/**
 *
 * TIER API
 *
 * client (currently web client) talking to the web server to work on tier
 */
module.exports = rest_api({

    name: 'tier_api',

    methods: {

        create_tier: {
            doc: 'Create tier',
            method: 'POST',
            path: '/tier',
            params: {
                type: 'object',
                requires: ['name', 'kind'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    kind: {
                        type: 'string',
                    },
                    edge_details: {
                        $ref: '/tier_api/definitions/edge_details'
                    },
                    cloud_details: {
                        $ref: '/tier_api/definitions/cloud_details'
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
            path: '/tier/:name',
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
            path: '/tier/:name',
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
                }
            },
            auth: {
                system: 'admin'
            }
        },

        delete_tier: {
            doc: 'Delete tier',
            method: 'DELETE',
            path: '/tier/:name',
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
            required: ['name', 'kind', 'storage', 'nodes'],
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

    }

});
