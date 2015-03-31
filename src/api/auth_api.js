'use strict';

/**
 *
 * AUTH API
 *
 * client (currently web client) talking to the web server to authenticate
 *
 */
module.exports = {

    name: 'auth_api',

    methods: {

        create_auth: {
            doc: 'Authenticate account with credentials, ' +
                'and returns an access token. ' +
                'supply a system name to create a token for acting on the system.',
            method: 'POST',
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
                    extra: {
                        type: 'object',
                        additionalProperties: true
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
            },
            auth: {
                account: false,
                system: false,
            }
        },

        read_auth: {
            doc: 'Get info about the authenticated token.',
            method: 'GET',
            reply: {
                type: 'object',
                required: [],
                properties: {
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
                            is_support: {
                                type: 'boolean',
                            },
                        },
                    },
                    system: {
                        type: 'object',
                        required: ['name'],
                        properties: {
                            name: {
                                type: 'string',
                            },
                        }
                    },
                    role: {
                        type: 'string',
                    },
                    extra: {
                        type: 'object',
                        additionalProperties: true
                    },
                }
            },
            auth: {
                account: false,
                system: false,
            }
        }

    },

};
