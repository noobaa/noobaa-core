/* Copyright (C) 2025 NooBaa */
'use strict';

module.exports = {
    $id: 'nsfs_vector_bucket_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'owner_account',
        'creation_date',
    ],
    properties: {
        _id: {
            type: 'string',
        },
        name: {
            type: 'string',
        },
        owner_account: {
            type: 'string',
        },
        creation_date: {
            type: 'string',
        },
        vector_policy: {
            $ref: 'common_api#/definitions/bucket_policy',
        },
    }
};
