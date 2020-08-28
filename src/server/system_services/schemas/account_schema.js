/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');

module.exports = {
    id: 'account_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'email',
        'has_login'
    ],
    properties: {

        // identity
        _id: { objectid: true },
        deleted: { date: true },
        name: { wrapper: SensitiveString },
        email: { wrapper: SensitiveString },
        is_support: { type: 'boolean' },
        is_external: { type: 'boolean' },

        // password login
        has_login: { type: 'boolean' },
        password: { wrapper: SensitiveString }, // bcrypted password
        next_password_change: { date: true },

        // default policy for new buckets
        default_pool: { objectid: true },
        default_chunk_config: { objectid: true },

        allow_bucket_creation: { type: 'boolean' },

        access_keys: {
            type: 'array',
            items: {
                type: 'object',
                required: ['access_key', 'secret_key'],
                properties: {
                    access_key: { $ref: 'common_api#/definitions/access_key' },
                    secret_key: { $ref: 'common_api#/definitions/secret_key' },
                }
            }
        },

        allowed_buckets: {
            type: 'object',
            required: ['full_permission'],
            properties: {
                full_permission: { type: 'boolean' },
                permission_list: {
                    type: 'array',
                    items: { objectid: true },
                }
            }
        },

        allowed_ips: {
            type: 'array',
            items: {
                type: 'object',
                required: ['start', 'end'],
                properties: {
                    start: { type: 'string' },
                    end: { type: 'string' },
                }
            }
        },

        sync_credentials_cache: {
            type: 'array',
            items: {
                type: 'object',
                required: ['name', 'endpoint', 'access_key', 'secret_key'],
                properties: {
                    name: { type: 'string' },
                    access_key: { $ref: 'common_api#/definitions/access_key' },
                    secret_key: { $ref: 'common_api#/definitions/secret_key' },
                    auth_method: {
                        type: 'string',
                        enum: ['AWS_V2', 'AWS_V4']
                    },
                    endpoint: { type: 'string' },
                    cp_code: { type: 'string' },
                    endpoint_type: {
                        type: 'string',
                        enum: ['AWS', 'AZURE', 'S3_COMPATIBLE', 'GOOGLE', 'FLASHBLADE', 'NET_STORAGE', 'IBM_COS']
                    },
                }
            }
        },

        preferences: {
            type: 'object',
            properties: {
                ui_theme: {
                    type: 'string',
                    enum: ['DARK', 'LIGHT']
                }
            }
        }
    }
};
