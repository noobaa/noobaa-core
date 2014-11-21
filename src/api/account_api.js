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
            method: 'GET',
            path: '/',
            reply: {
                type: 'object',
                required: ['name', 'email'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    email: {
                        type: 'string',
                    },
                },
            },
        },

        update_account: {
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
            method: 'DELETE',
            path: '/',
        },


        ////////////////////
        // LOGIN / LOGOUT //
        ////////////////////

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
        },

        logout_account: {
            method: 'POST',
            path: '/logout',
            doc: 'logout current account',
        },

    },

});
