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
            method: 'GET',
            path: '/system/:id',
            params: {
                $ref: '/system_api/definitions/system_id'
            },
            reply: {
                $ref: '/system_api/definitions/system_full_info'
            },
        },

        update_system: {
            doc: 'List the systems that the current account has a role',
            method: 'PUT',
            path: '/system/:id',
            params: {
                $ref: '/system_api/definitions/system_info'
            },
        },

        delete_system: {
            doc: 'Delete ',
            method: 'DELETE',
            path: '/system/:id',
            params: {
                $ref: '/system_api/definitions/system_id'
            },
        },


        //////////
        // LIST //
        //////////

        list_systems: {
            doc: 'List the systems that the current account has a role',
            method: 'GET',
            path: '/systems/',
            reply: {
                type: 'array',
                items: {
                    $ref: '/system_api/definitions/system_info'
                }
            },
        },


        ////////////////////
        // LOGIN / LOGOUT //
        ////////////////////

        login_system: {
            method: 'GET',
            path: '/login/:id',
            params: {
                type: 'object',
                required: ['id'],
                properties: {
                    id: {
                        type: 'string',
                    },
                },
            },
        },

        logout_system: {
            method: 'GET',
            path: '/logout',
        },

    },


    ////////////////////////////////
    // general schema definitions //
    ////////////////////////////////

    definitions: {

        system_id: {
            type: 'object',
            required: ['id'],
            properties: {
                id: {
                    type: 'string',
                },
            },
        },

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
                'allocated_storage',
                'used_storage',
                'chunks_storage',
                'nodes',
                'online_nodes',
                'buckets',
                'objects',
                'roles',
                'tiers',
                'vendors',
            ],
            properties: {
                id: {
                    type: 'string',
                },
                name: {
                    type: 'string',
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
                roles: {
                    type: 'array',
                    items: {
                        $ref: '/system_api/definitions/role_info'
                    }
                },
                tiers: {
                    type: 'array',
                    items: {
                        $ref: '/system_api/definitions/tier_info'
                    }
                },
                vendors: {
                    type: 'array',
                    items: {
                        $ref: '/system_api/definitions/vendor_info'
                    }
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


        tier_info: {
            type: 'object',
            required: ['name'],
            properties: {
                name: {
                    type: 'string',
                },
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
