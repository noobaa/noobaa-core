// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


module.exports = rest_api({

    name: 'account_api',

    methods: {

        //////////
        // CRUD //
        //////////

        create_account: {
            doc: 'Create a new account',
            method: 'POST',
            path: '/account',
            params: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    email: {
                        type: 'string',
                    },
                    password: {
                        type: 'string',
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['id'],
                properties: {
                    id: {
                        type: 'string',
                    },
                },
            }
        },

        read_account: {
            doc: 'Read the info of the authorized account',
            method: 'GET',
            path: '/account',
            reply: {
                type: 'object',
                required: ['id', 'name', 'email', 'systems_role'],
                properties: {
                    id: {
                        type: 'string',
                    },
                    name: {
                        type: 'string',
                    },
                    email: {
                        type: 'string',
                    },
                    systems_role: {
                        type: 'object',
                        patternProperties: {
                            '^[0-9a-f]*$': {
                                type: 'string',
                                enum: ['admin', 'agent'],
                            }
                        }
                    }
                },
            },
        },

        update_account: {
            doc: 'Update the info of the authorized account',
            method: 'PUT',
            path: '/account',
            params: {
                type: 'object',
                required: [],
                properties: {
                    name: {
                        type: 'string',
                    },
                    email: {
                        type: 'string',
                    },
                    password: {
                        type: 'string',
                    },
                }
            },
        },

        delete_account: {
            doc: 'Delete the authorized account',
            method: 'DELETE',
            path: '/account',
        },


        //////////
        // AUTH //
        //////////

        authenticate: {
            doc: 'Authenticate account with credentials, ' +
                'and returns an access token. ' +
                'supply a system id to create a token for acting on the system.',
            method: 'POST',
            path: '/auth',
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
                    system: {
                        type: 'string',
                    },
                    expires: {
                        type: 'integer',
                        doc: 'Number of seconds before the authentication expires',
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['token'],
                properties: {
                    token: {
                        type: 'string',
                    },
                }
            }
        },

        authenticate_update: {
            doc: 'Authenticate based on previous token, to get a different token '+
                'for example in order to use system_id.',
            method: 'PUT',
            path: '/auth',
            params: {
                type: 'object',
                required: [],
                properties: {
                    system: {
                        type: 'string',
                    },
                    expires: {
                        type: 'integer',
                        doc: 'Number of seconds before the authentication expires',
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['token'],
                properties: {
                    token: {
                        type: 'string',
                    },
                }
            }
        },

    },

});
