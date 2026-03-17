/* Copyright (C) 2025 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');

module.exports = {
    $id: 'vector_bucket_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'name',
    ],
    properties: {
        _id: {
            objectid: true
        },
        system: {
            objectid: true
        },
        name: {
            wrapper: SensitiveString,
        },
        owner_account: {
            objectid: true
        },
        vector_db_type: { $ref: 'common_api#/definitions/vector_db_type' },
        vector_db_config: {
            type: 'object',
            properties: {
                namespace_resource: {
                    type: 'object',
                    properties: {
                        resource: { objectid: true },
                        path: { type: 'string' },
                    },
                },
            },
        },
        tags: { $ref: 'common_api#/definitions/tagging' },
        bucket_claim: { $ref: 'common_api#/definitions/bucket_claim' },
        creation_time: {
            idate: true
        },
        deleted: {
            date: true
        },
        vector_policy: {
            $ref: 'common_api#/definitions/bucket_policy'
        },
    }
};
