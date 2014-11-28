// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


module.exports = rest_api({

    name: 'tier_api',

    methods: {

        //////////
        // CRUD //
        //////////

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
                }
            },
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
                }
            },
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
        },


    },


    ////////////////////////////////
    // general schema definitions //
    ////////////////////////////////

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
                cloud_details: {
                    type: 'object',
                    // vendor specific properties
                    additionalProperties: true,
                },
                storage: {
                    $ref: '/system_api/definitions/storage_info'
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

    }

});
