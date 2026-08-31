/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');

const account_properties = {

        // identity
        _id: { objectid: true },
        master_key_id: { objectid: true },
        deleted: { date: true },
        name: { wrapper: SensitiveString },
        email: { wrapper: SensitiveString },
        is_support: { type: 'boolean' },
        is_external: { type: 'boolean' },
        identity_type: { $ref: 'common_api#/definitions/identity_type' },

        // password login
        has_login: { type: 'boolean' },
        password: { wrapper: SensitiveString }, // bcrypted password - DEPRECATED
        next_password_change: { date: true }, // DEPRECATED
        // owner account id for IAM user or role, not present for accounts
        owner: { objectid: true },
        tagging: {
            $ref: 'common_api#/definitions/tagging',
        },
        iam_path: { type: 'string' },
        iam_inline_policies: {
            type: 'array',
            items: {
                $ref: 'common_api#/definitions/iam_inline_policy',
            }
        },

        description: { // role-only
            type: 'string',
        },
        max_session_duration: { // role-only
            type: 'integer',
            minimum: 3600,
            maximum: 43200,
        },
        assume_role_policy_document: { // role-only
            $ref: 'common_api#/definitions/iam_trust_policy_document',
        },
        creation_date: { idate: true },
        // default policy for new buckets
        default_resource: { objectid: true },
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
                    deactivated: { type: 'boolean' },
                    creation_date: { idate: true },
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
                required: ['name', 'endpoint'],
                properties: {
                    name: { type: 'string' },
                    access_key: { $ref: 'common_api#/definitions/access_key' },
                    secret_key: { $ref: 'common_api#/definitions/secret_key' },
                    azure_log_access_keys: { $ref: 'common_api#/definitions/azure_log_access_keys' },
                    aws_sts_arn: {
                        type: 'string'
                    },
                    azure_sts_credentials: {
                        $ref: 'common_api#/definitions/azure_sts_credentials'
                    },
                    auth_method: {
                        type: 'string',
                        enum: ['AWS_V2', 'AWS_V4']
                    },
                    endpoint: { type: 'string' },
                    region: { type: 'string' },
                    cp_code: { type: 'string' },
                    endpoint_type: {
                        type: 'string',
                        enum: ['AWSSTS', 'AWS', 'AZURE', 'AZURESTS', 'S3_COMPATIBLE', 'GOOGLE', 'GOOGLE_STS', 'FLASHBLADE', 'NET_STORAGE', 'IBM_COS']
                    },
                }
            }
        },

        force_md5_etag: {
            type: 'boolean' // enable md5 calculation per account
        },

        preferences: {
            type: 'object',
            properties: {
                ui_theme: {
                    type: 'string',
                    enum: ['DARK', 'LIGHT']
                }
            }
        },
        // nsfs properties for account
        nsfs_account_config: {
            $ref: 'common_api#/definitions/nsfs_account_config'
        },

        role_config: {
            $ref: 'common_api#/definitions/role_config'
        },
};

module.exports = {
    $id: 'account_schema',
    type: 'object',
    properties: account_properties,
    oneOf: [{
        type: 'object',
        required: ['_id', 'name', 'email', 'has_login', 'identity_type'],
        properties: {
            ...account_properties,
            identity_type: {
                type: 'string',
                enum: ['ACCOUNT'],
            },
        },
    }, {
        type: 'object',
        required: ['_id', 'name', 'email', 'has_login', 'owner', 'identity_type'],
        properties: {
            ...account_properties,
            identity_type: {
                type: 'string',
                enum: ['USER'],
            },
        },
    }, {
        type: 'object',
        required: ['_id', 'name', 'owner', 'assume_role_policy_document', 'identity_type'],
        properties: {
            ...account_properties,
            identity_type: {
                type: 'string',
                enum: ['ROLE'],
            },
        },
    }, {
        type: 'object',
        properties: account_properties,
        not: { required: ['identity_type'] },
        required: ['_id', 'name', 'email', 'has_login'],
    }],
};
