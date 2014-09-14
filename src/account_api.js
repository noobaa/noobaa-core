// this module is written for both nodejs, or for client with browserify.
'use strict';

var restful_api = require('./restful_api');


module.exports = restful_api.define_api({

    name: 'Account',

    methods: {

        login_account: {
            method: 'POST',
            path: '/login',
            params: {
                email: {
                    type: String,
                    required: true,
                },
                password: {
                    type: String,
                    required: true,
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
                email: {
                    type: String,
                    required: true,
                    doc: [
                        'email is used to identify the account. ',
                        'an email can be used for one account only.',
                    ].join(''),
                },
                password: {
                    type: String,
                    required: true,
                    doc: 'password for account authentication',
                },
            },
            doc: 'create a new account',
        },

        read_account: {
            method: 'GET',
            path: '/',
            reply: {
                email: {
                    type: String,
                    required: true,
                },
            },
            doc: 'return the current logged in account info',
        },

        update_account: {
            method: 'PUT',
            path: '/',
            params: {
                email: {
                    type: String,
                    required: true,
                },
            },
            doc: 'update the current logged in account info',
        },

        delete_account: {
            method: 'DELETE',
            path: '/',
            doc: 'delete the current logged in account',
        },

    }

});
