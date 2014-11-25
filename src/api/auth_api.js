// this module is written for both nodejs, or for client with browserify.
'use strict';

var rest_api = require('../util/rest_api');


module.exports = rest_api({

    name: 'auth_api',

    methods: {

        //////////
        // CRUD //
        //////////

        create_auth: {
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

        update_auth: {
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
