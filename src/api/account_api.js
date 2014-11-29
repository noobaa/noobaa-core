// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');

/**
 *
 * ACCOUNT API
 *
 */
module.exports = rest_api({

    name: 'account_api',

    methods: {

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
            }
        },

        read_account: {
            doc: 'Read the info of the authorized account',
            method: 'GET',
            path: '/account',
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

    },

});
