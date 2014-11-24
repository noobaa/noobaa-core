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
            doc: 'Create a new account and login to it',
            method: 'POST',
            path: '/',
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
        },

        read_account: {
            doc: 'Read the info of the logged in account',
            method: 'GET',
            path: '/',
            reply: {
                type: 'object',
                required: ['name', 'email', 'systems_role'],
                properties: {
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
            doc: 'Update the info of the logged in account',
            method: 'PUT',
            path: '/',
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
            doc: 'Delete the logged in account, and logout',
            method: 'DELETE',
            path: '/',
        },


        ////////////////////
        // LOGIN / LOGOUT //
        ////////////////////

        login_account: {
            doc: 'Login to account with credentials, saved in cookie session',
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
        },

        logout_account: {
            doc: 'Logout from account, cleared from cookie session',
            method: 'POST',
            path: '/logout',
        },

    },

});
