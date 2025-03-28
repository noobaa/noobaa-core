/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'namespace_resource_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'account',
        'name',
    ],
    properties: {
        _id: {
            objectid: true
        },
        deleted: {
            date: true
        },
        system: {
            objectid: true
        },
        account: {
            objectid: true
        },
        name: {
            type: 'string'
        },
        connection: {
            type: 'object',
            required: ['endpoint_type', 'endpoint', 'target_bucket', 'access_key', 'secret_key'],
            properties: {
                aws_sts_arn: {
                    type: 'string'
                },
                endpoint_type: {
                    type: 'string',
                    enum: ['AWSSTS', 'AWS', 'AZURE', 'S3_COMPATIBLE', 'GOOGLE', 'FLASHBLADE', 'NET_STORAGE', 'IBM_COS']
                },
                auth_method: {
                    type: 'string',
                    enum: ['AWS_V2', 'AWS_V4']
                },
                endpoint: {
                    type: 'string'
                },
                region: {
                    type: 'string'
                },
                target_bucket: {
                    type: 'string'
                },
                access_key: { $ref: 'common_api#/definitions/access_key' },
                secret_key: { $ref: 'common_api#/definitions/secret_key' },
                azure_log_access_keys: { $ref: 'common_api#/definitions/azure_log_access_keys' },
                gcp_hmac_key: { $ref: 'common_api#/definitions/gcp_hmac_key' },
                cp_code: {
                    type: 'string'
                }
            }
        },
        nsfs_config: {
            $ref: 'common_api#/definitions/nsfs_config'
        },
        access_mode: {
            type: 'string',
            enum: ['READ_ONLY', 'READ_WRITE']
        },
        issues_report: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    time: {
                        idate: true
                    },
                    error_code: {
                        type: 'string'
                    }
                }
            }
        },
        last_monitoring: {
            idate: true
        },
        namespace_store: {
            type: 'object',
            properties: {
                name: {
                    type: 'string'
                },
                namespace: {
                    type: 'string'
                },
                need_k8s_sync: {
                    type: 'boolean'
                }
            }
        }
    }
};
