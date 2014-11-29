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
                'supply a system name to create a token for acting on the system.',
            method: 'POST',
            path: '/auth',
            params: {
                type: 'object',
                required: [],
                properties: {
                    email: {
                        doc: 'If email is provided the new authorization will refer to it. ' +
                            'If no email, the currently authorized account will be used.',
                        type: 'string',
                    },
                    password: {
                        doc: 'If password is supplied then the email will be verified using it. ' +
                            'If no password then the currently authorized account ' +
                            'should be permitted to delegate such authorization (e.g. admin).',
                        type: 'string',
                    },
                    system: {
                        type: 'string',
                    },
                    role: {
                        type: 'string',
                    },
                    bucket: {
                        type: 'string',
                    },
                    object: {
                        type: 'string',
                    },
                    expiry: {
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

        read_auth: {
            doc: 'Get info about the authenticated token.',
            method: 'GET',
            path: '/auth',
            reply: {
                type: 'object',
                required: [],
                properties: {
                    account: {
                        type: 'object',
                        required: [],
                        properties: {
                            name: {
                                type: 'string',
                            },
                            email: {
                                type: 'string',
                            },
                        }
                    },
                    system: {
                        type: 'object',
                        required: [],
                        properties: {
                            name: {
                                type: 'string',
                            },
                        }
                    },
                    role: {
                        type: 'string',
                    },
                    bucket: {
                        type: 'string',
                    },
                    object: {
                        type: 'string',
                    },
                }
            }
        }

    },

});
