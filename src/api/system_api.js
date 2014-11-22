// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


module.exports = rest_api({

    name: 'system_api',

    methods: {

        list_systems: {
            method: 'GET',
            path: '/systems/',
            reply: {
                type: 'array',
                items: {
                    $ref: '/system_api/definitions/system_info'
                }
            },
        },

        create_system: {
            method: 'POST',
            path: '/system/',
            params: {
                $ref: '/system_api/definitions/system_info'
            },
        },

        read_system: {
            method: 'GET',
            path: '/system/:id',
            params: {
                $ref: '/system_api/definitions/system_id'
            },
            reply: {
                $ref: '/system_api/definitions/system_info'
            },
        },

        update_system: {
            method: 'PUT',
            path: '/system/:id',
            params: {
                type: 'object',
                required: ['id'],
                properties: {
                    id: {
                        type: 'string',
                    },
                    name: {
                        type: 'string',
                    },
                },
            },
        },

        delete_system: {
            method: 'DELETE',
            path: '/system/:id',
            params: {
                $ref: '/system_api/definitions/system_id'
            },
        },


        connect_system: {
            method: 'GET',
            path: '/connect',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                },
            },
        },

        system_stats: {
            method: 'GET',
            path: '/stats',
            reply: {
                type: 'object',
                required: [
                    'allocated_storage',
                    'used_storage',
                    'chunks_storage',
                    'nodes',
                    'online_nodes',
                    'node_vendors',
                    'buckets',
                    'objects',
                ],
                properties: {
                    allocated_storage: {
                        $ref: '/system_api/definitions/bigint'
                    },
                    used_storage: {
                        $ref: '/system_api/definitions/bigint'
                    },
                    chunks_storage: {
                        $ref: '/system_api/definitions/bigint'
                    },
                    nodes: {
                        type: 'integer'
                    },
                    online_nodes: {
                        type: 'integer'
                    },
                    node_vendors: {
                        type: 'integer'
                    },
                    buckets: {
                        type: 'integer'
                    },
                    objects: {
                        type: 'integer'
                    },
                }
            },
        },

    },


    ////////////////////////////////
    // general schema definitions //
    ////////////////////////////////

    definitions: {

        system_info: {
            type: 'object',
            required: ['id', 'name'],
            properties: {
                id: {
                    type: 'string',
                },
                name: {
                    type: 'string',
                },
            },
        },

        system_id: {
            type: 'object',
            required: ['id'],
            properties: {
                id: {
                    type: 'string',
                },
            },
        },

        bigint: {
            oneOf: [{
                type: 'integer'
            }, {
                type: 'object',
                properties: {
                    n: {
                        type: 'integer',
                    },
                    // to support bigger integers we can specify a peta field
                    // which is considered to be based from 2^50
                    peta: {
                        type: 'integer',
                    }
                }
            }]
        },

    }

});
