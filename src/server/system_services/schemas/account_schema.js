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
        master_key_id: { objectid: true },
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

        bucket_claim_owner: { objectid: true },

        sync_credentials_cache: {
            type: 'array',
            items: {
                type: 'object',
                required: ['name', 'endpoint', 'access_key', 'secret_key'],
                properties: {
                    name: { type: 'string' },
                    endpoint: { type: 'string' },
                    endpoint_type: { $ref: 'common_api#/definitions/endpoint_type' },
                    auth_method: { $ref: 'common_api#/definitions/cloud_auth_method' },
                    access_key: { $ref: 'common_api#/definitions/access_key' },
                    secret_key: { $ref: 'common_api#/definitions/secret_key' },
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
