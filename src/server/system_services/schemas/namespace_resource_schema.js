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
                endpoint: { type: 'string' },
                endpoint_type: { $ref: 'common_api#/definitions/endpoint_type' },
                auth_method: { $ref: 'common_api#/definitions/cloud_auth_method' },
                access_key: { $ref: 'common_api#/definitions/access_key' },
                secret_key: { $ref: 'common_api#/definitions/secret_key' },
                target_bucket: { type: 'string' },
            }
        },
    }
};
