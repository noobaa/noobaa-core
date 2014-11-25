// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


module.exports = rest_api({

    name: 'system_api',

    methods: {

        //////////
        // CRUD //
        //////////

        create_system: {
            method: 'POST',
            path: '/system/',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                },
            },
            reply: {
                $ref: '/system_api/definitions/system_info'
            },
        },

        read_system: {
            doc: 'Read the info of the authorized system',
            method: 'GET',
            path: '/system',
            reply: {
                $ref: '/system_api/definitions/system_full_info'
            },
        },

        update_system: {
            doc: 'Update the authorized system',
            method: 'PUT',
            path: '/system',
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

        delete_system: {
            doc: 'Delete the authorized system',
            method: 'DELETE',
            path: '/system',
        },


        //////////
        // LIST //
        //////////

        list_systems: {
            doc: 'List the systems that the authorized account can access',
            method: 'GET',
            path: '/systems',
            reply: {
                type: 'array',
                items: {
                    $ref: '/system_api/definitions/system_info'
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

        system_full_info: {
            type: 'object',
            required: [
                'id',
                'name',
                'roles',
                'vendors',
                'tiers',
                'nodes',
                'online_nodes',
                'buckets',
                'objects',
                'allocated_storage',
                'used_storage',
                'chunks_storage',
            ],
            properties: {
                id: {
                    type: 'string',
                },
                name: {
                    type: 'string',
                },
                roles: {
                    type: 'array',
                    items: {
                        $ref: '/system_api/definitions/role_info'
                    }
                },
                vendors: {
                    type: 'array',
                    items: {
                        $ref: '/system_api/definitions/vendor_info'
                    }
                },
                tiers: {
                    type: 'array',
                    items: {
                        $ref: '/system_api/definitions/tier_info'
                    }
                },
                nodes: {
                    type: 'integer'
                },
                online_nodes: {
                    type: 'integer'
                },
                buckets: {
                    type: 'integer'
                },
                objects: {
                    type: 'integer'
                },
                allocated_storage: {
                    $ref: '/system_api/definitions/bigint'
                },
                used_storage: {
                    $ref: '/system_api/definitions/bigint'
                },
                chunks_storage: {
                    $ref: '/system_api/definitions/bigint'
                },
            }
        },

        role_info: {
            type: 'object',
            required: ['role', 'account'],
            properties: {
                role: {
                    type: 'string',
                },
                account: {
                    type: 'object',
                    required: ['name', 'email'],
                    properties: {
                        name: {
                            type: 'string',
                        },
                        email: {
                            type: 'string',
                        },
                    }
                }
            }
        },


        vendor_info: {
            type: 'object',
            required: ['name', 'category', 'kind'],
            properties: {
                name: {
                    type: 'string',
                },
                category: {
                    type: 'string',
                },
                kind: {
                    type: 'string',
                },
            }
        },


        tier_info: {
            type: 'object',
            required: ['name'],
            properties: {
                name: {
                    type: 'string',
                },
            }
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
