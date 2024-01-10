/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'bucket_schema',
    type: 'object',
    required: [
        'name',
        'system_owner',
        'bucket_owner',
        'versioning',
        'path',
        'should_create_underlying_storage',
        'creation_date',
    ],
    properties: {
        name: {
            type: 'string',
        },
        system_owner: {
            type: 'string',
        },
        bucket_owner: {
            type: 'string',
        },
        tag: {
            type: 'string',
        },
        versioning: {
            type: 'string',
            enum: ['DISABLED', 'SUSPENDED', 'ENABLED']
            // GAP would like to use $ref: 'bucket_api#/definitions/versioning'
            // but currently it creates an error Error: reference "bucket_api" resolves to more than one schema
        },
        path: {
            type: 'string',
        },
        should_create_underlying_storage: {
            type: 'boolean',
        },
        creation_date: {
            type: 'string',
        },
        fs_backend: {
            $ref: 'common_api#/definitions/fs_backend'
        },
        s3_policy: {
            $ref: 'common_api#/definitions/bucket_policy',
        }
    }
};
