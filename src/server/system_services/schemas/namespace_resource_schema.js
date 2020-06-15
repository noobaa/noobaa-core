/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'namespace_resource_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'account',
        'name',
        'connection'
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
                endpoint_type: {
                    type: 'string',
                    enum: ['AWS', 'AZURE', 'S3_COMPATIBLE', 'GOOGLE', 'FLASHBLADE', 'NET_STORAGE', 'IBM_COS']
                },
                auth_method: {
                    type: 'string',
                    enum: ['AWS_V2', 'AWS_V4']
                },
                endpoint: {
                    type: 'string'
                },
                target_bucket: {
                    type: 'string'
                },
                access_key: { $ref: 'common_api#/definitions/access_key' },
                secret_key: { $ref: 'common_api#/definitions/secret_key' },
                cp_code: {
                    type: 'string'
                }
            }
        },
    }
};
