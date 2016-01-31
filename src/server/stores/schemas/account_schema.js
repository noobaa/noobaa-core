'use strict';

module.exports = {
    id: 'account_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'email',
        'password',
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        deleted: {
            format: 'date'
        },
        name: {
            type: 'string'
        },
        email: {
            type: 'string'
        },
        password: {
            type: 'string' // bcrypted password
        },
        is_support: {
            type: 'boolean'
        },
        sync_credentials_cache: {
            type: 'array',
            items: {
                type: 'object',
                required: ['access_key', 'secret_key'],
                properties: {
                    access_key: {
                        type: 'string'
                    },
                    secret_key: {
                        type: 'string'
                    }
                }
            }
        }
    }
};
