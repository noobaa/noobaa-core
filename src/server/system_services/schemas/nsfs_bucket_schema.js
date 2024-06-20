/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'bucket_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'system_owner',
        'owner_account',
        'versioning',
        'path',
        'should_create_underlying_storage',
        'creation_date',
    ],
    properties: {
        _id: {
            type: 'string',
        },
        // owner_account is the account _id
        owner_account: {
            type: 'string',
        },
        name: {
            type: 'string',
        },
        system_owner: {
            type: 'string',
        },
        tag: {
            $ref: 'common_api#/definitions/tagging',
        },
        versioning: {
            $ref: 'common_api#/definitions/versioning',
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
        },
        encryption: {
            $ref: 'common_api#/definitions/bucket_encryption',
        },
        website: {
            $ref: 'common_api#/definitions/bucket_website',
        },
        force_md5_etag: {
            type: 'boolean',
        },
        logging: {
            $ref: 'common_api#/definitions/bucket_logging',
        },
    }
};
