/* Copyright (C) 2016 NooBaa */

export default {
    oneOf: [
        {
            type: 'null'
        },
        {
            type: 'object',
            required: [
                'token',
                'user',
                'system',
                'persistent',
                'passwordExpired',
                'authorizedBy',
                'uiTheme'
            ],
            properties: {
                token: {
                    type: 'string'
                },
                expired: {
                    type: 'boolean'
                },
                user: {
                    type: 'string'
                },
                system: {
                    type: 'string'
                },
                persistent: {
                    type: 'boolean'
                },
                passwordExpired: {
                    type: 'boolean'
                },
                authorizedBy: {
                    type: 'string',
                    enum: [
                        'noobaa',
                        'k8s'
                    ]
                },
                uiTheme: {
                    type: 'string',
                    enum: [
                        'dark',
                        'light'
                    ]
                }
            }
        }
    ]
};
