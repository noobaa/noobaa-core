// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


module.exports = rest_api({

    name: 'account_api',

    methods: {

        login_account: {
            method: 'POST',
            path: '/login',
            params: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: {
                        type: 'string',
                    },
                    password: {
                        type: 'string',
                    },
                },
            },
            doc: 'login into account',
        },

        logout_account: {
            method: 'POST',
            path: '/logout',
            doc: 'logout current account',
        },

        create_account: {
            method: 'POST',
            path: '/',
            params: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: {
                        type: 'string',
                        doc: [
                            'email is used to identify the account. ',
                            'an email can be used for one account only.',
                        ].join(''),
                    },
                    password: {
                        type: 'string',
                        doc: 'password for account authentication',
                    },
                },
            },
            doc: 'create a new account',
        },

        read_account: {
            method: 'GET',
            path: '/',
            reply: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: {
                        type: 'string',
                    },
                },
            },
            doc: 'return the current logged in account info',
        },

        update_account: {
            method: 'PUT',
            path: '/',
            params: {
                type: 'object',
                properties: {
                    email: {
                        type: 'string',
                    },
                    password: {
                        type: 'string',
                    },
                }
            },
            doc: 'update the current logged in account info',
        },

        delete_account: {
            method: 'DELETE',
            path: '/',
            doc: 'delete the current logged in account',
        },


        get_stats: {
            method: 'GET',
            path: '/stats',
            params: {
                type: 'object',
                required: [],
                properties: {
                    system_stats: {
                        type: 'boolean'
                    }
                }
            },
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
                        $ref: '/account_api/definitions/bigint'
                    },
                    used_storage: {
                        $ref: '/account_api/definitions/bigint'
                    },
                    chunks_storage: {
                        $ref: '/account_api/definitions/bigint'
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
