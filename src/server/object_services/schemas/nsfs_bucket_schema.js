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
