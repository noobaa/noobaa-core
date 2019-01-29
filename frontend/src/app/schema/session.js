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
                'uiTheme'
            ],
            properties: {
                token: {
                    type: 'string'
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
