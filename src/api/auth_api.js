/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * AUTH API
 *
 * client (currently web client) talking to the web server to authenticate
 *
 */
module.exports = {

    $id: 'auth_api',

    methods: {

        create_auth: {
            doc: 'Authenticate account with credentials, ' +
                'and returns an access token. ' +
                'supply a system name to create a token for acting on the system.',
            method: 'POST',
            params: {
                type: 'object',
                // required: [],
                properties: {
                    email: {
                        doc: 'If email is provided the new authorization will refer to it. ' +
                            'If no email, the currently authorized account will be used.',
                        $ref: 'common_api#/definitions/email',
                    },
                    password: {
                        doc: 'If password is supplied then the email will be verified using it. ' +
                            'If no password then the currently authorized account ' +
                            'should be permitted to delegate such authorization (e.g. admin).',
                        $ref: 'common_api#/definitions/password',
                    },
                    authorized_by: {
                        type: 'string',
                        enum: [
                            'noobaa',
                            'oauth'
                        ]
                    },
                    system: {
                        type: 'string',
                    },
                    role: {
                        type: 'string',
                    },
                    extra: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    },
                    expiry: {
                        type: 'integer',
                        doc: 'Number of seconds before the authentication expires',
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['token', 'info'],
                properties: {
                    token: {
                        type: 'string',
                    },
                    info: {
                        $ref: '#/definitions/auth_info'
                    }
                }
            },
            auth: {
                account: false,
                system: false,
                anonymous: true,
            }
        },

        create_k8s_auth: {
            doc: 'Authenticate a k8s account using an OAuth grant code and return an access token.',
            method: 'POST',
            params: {
                type: 'object',
                required: ['grant_code'],
                properties: {
                    grant_code: {
                        type: 'string'
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['token', 'info'],
                properties: {
                    token: {
                        type: 'string',
                    },
                    info: {
                        $ref: '#/definitions/auth_info'
                    }
                }
            },
            auth: {
                account: false,
                system: false,
                anonymous: true,
            }
        },

        create_access_key_auth: {
            doc: 'Authenticate account with access key, ' +
                'and returns an access token. ' +
                'supply a system name to create a token for acting on the system.',
            method: 'POST',
            params: {
                type: 'object',
                required: ['access_key', 'string_to_sign', 'signature'],
                properties: {
                    access_key: { $ref: 'common_api#/definitions/access_key' },
                    string_to_sign: {
                        doc: 'string used to sign with access key and secret key in order to verify the token',
                        type: 'string',
                    },
                    signature: {
                        type: 'string',
                    },
                    extra: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
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
                anonymous: true,
            }
        },

        read_auth: {
            doc: 'Get info about the authenticated token.',
            method: 'GET',
            reply: {
                $ref: '#/definitions/auth_info'
            },
            auth: {
                account: false,
                system: false,
                anonymous: true,
            }
        }

    },

    definitions: {
        auth_info: {
            type: 'object',
            // required: [],
            properties: {
                account: {
                    type: 'object',
                    required: ['name', 'email'],
                    properties: {
                        name: { $ref: 'common_api#/definitions/account_name' },
                        email: { $ref: 'common_api#/definitions/email' },
                        is_support: {
                            type: 'boolean',
                        },
                        must_change_password: {
                            type: 'boolean'
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
                authorized_by: {
                    type: 'string',
                    enum: [
                        'noobaa',
                        'k8s'
                    ]
                },
                role: {
                    type: 'string',
                },
                extra: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                },
            }
        },
    },
};
