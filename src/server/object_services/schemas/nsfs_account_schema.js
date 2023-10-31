/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'account_schema',
    type: 'object',
    required: [
        'name',
        'email',
        'access_keys',
        'nsfs_account_config',
        'creation_date',
    ],
    properties: {
        name: {
            type: 'string'
        },
        email: {
            type: 'string',
        },
        creation_date: {
            type: 'string',
        },
        access_keys: {
            type: 'array',
            items: {
                type: 'object',
                required: ['access_key', 'secret_key'],
                properties: {
                    access_key: {
                        type: 'string',
                    },
                    secret_key: {
                        type: 'string',
                    },
                }
            }
        },
        nsfs_account_config: {
            type: 'object',
            required: ['uid', 'gid', 'new_buckets_path'],
            properties: {
                uid: {
                    type: 'number'
                },
                gid: {
                    type: 'number'
                },
                new_buckets_path: {
                    type: 'string'
                }
            }
        }
    }
};
