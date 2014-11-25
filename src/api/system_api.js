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


        ///////////
        // ROLES //
        ///////////

        add_role: {
            doc: 'Add role',
            method: 'POST',
            path: '/role',
            params: {
                type: 'object',
                requires: ['role', 'email'],
                properties: {
                    email: {
                        type: 'string',
                    },
                    role: {
                        $ref: '/system_api/definitions/role_enum'
                    },
                }
            },
        },

        remove_role: {
            doc: 'Remove role',
            method: 'DELETE',
            path: '/role/:email',
            params: {
                type: 'object',
                requires: ['email'],
                properties: {
                    email: {
                        type: 'string',
                    },
                }
            },
        },

        /////////////
        // VENDORS //
        /////////////

        add_vendor: {
            doc: 'Add vendor',
            method: 'POST',
            path: '/vendor',
            params: {
                type: 'object',
                required: ['name', 'category', 'kind', 'details'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    category: {
                        $ref: '/system_api/definitions/vendor_category'
                    },
                    kind: {
                        $ref: '/system_api/definitions/vendor_kind'
                    },
                    details: {
                        type: 'object',
                        // vendor specific properties
                        additionalProperties: true,
                    },
                }
            },
        },

        remove_vendor: {
            doc: 'Remove vendor',
            method: 'DELETE',
            path: '/vendor/:name',
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

        ///////////
        // TIERS //
        ///////////

        add_tier: {
            doc: 'Add tier',
            method: 'POST',
            path: '/tier',
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

        remove_tier: {
            doc: 'Remove tier',
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
                'storage',
                'nodes',
                'buckets',
                'objects',
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
                storage: {
                    $ref: '/system_api/definitions/storage_info'
                },
                nodes: {
                    $ref: '/system_api/definitions/nodes_info'
                },
                buckets: {
                    type: 'integer'
                },
                objects: {
                    type: 'integer'
                },
            }
        },


        role_info: {
            type: 'object',
            required: ['role', 'account'],
            properties: {
                role: {
                    $ref: '/system_api/definitions/role_enum'
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
            required: ['name', 'category', 'kind', 'details', 'storage', 'nodes'],
            properties: {
                name: {
                    type: 'string',
                },
                category: {
                    $ref: '/system_api/definitions/vendor_category'
                },
                kind: {
                    $ref: '/system_api/definitions/vendor_kind'
                },
                details: {
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


        tier_info: {
            type: 'object',
            required: ['name', 'storage', 'nodes'],
            properties: {
                name: {
                    type: 'string',
                },
                storage: {
                    $ref: '/system_api/definitions/storage_info'
                },
                nodes: {
                    $ref: '/system_api/definitions/nodes_info'
                },
            }
        },


        role_enum: {
            enum: ['admin', 'agent'],
            type: 'string',
        },

        vendor_category: {
            enum: ['vm', 'storage'],
            type: 'string',
        },

        vendor_kind: {
            enum: ['agent_host', 'aws.ec2', 'aws.s3'],
            type: 'string',
        },

        nodes_info: {
            type: 'object',
            required: ['count', 'online'],
            properties: {
                count: {
                    type: 'integer'
                },
                online: {
                    type: 'integer'
                },
            }
        },

        storage_info: {
            type: 'object',
            required: ['alloc', 'used'],
            properties: {
                alloc: {
                    $ref: '/system_api/definitions/bigint'
                },
                used: {
                    $ref: '/system_api/definitions/bigint'
                },
                real: {
                    $ref: '/system_api/definitions/bigint'
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
