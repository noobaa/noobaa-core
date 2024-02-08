/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'account_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'email', // temp, keep the email internally
        'access_keys',
        'nsfs_account_config',
        'creation_date',
        'allow_bucket_creation',
    ],
    properties: {
        _id: {
            type: 'string',
        },
        name: {
            type: 'string'
        },
        email: {
            type: 'string',
        },
        creation_date: {
            type: 'string',
        },
        allow_bucket_creation: {
            type: 'boolean',
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
            oneOf: [{
                type: 'object',
                required: ['uid', 'gid'],
                properties: {
                    uid: { type: 'number' },
                    gid: { type: 'number' },
                    new_buckets_path: { type: 'string' },
                    fs_backend: {
                        $ref: 'common_api#/definitions/fs_backend'
                    }
                }
            }, {
                type: 'object',
                required: [ 'distinguished_name'],
                properties: {
                    distinguished_name: { type: 'string' },
                    new_buckets_path: { type: 'string' },
                    fs_backend: {
                        $ref: 'common_api#/definitions/fs_backend'
                    }
                }
            }]
        },
    }
};
