/* Copyright (C) 2025 NooBaa */
'use strict';

const SensitiveString = require('../../../util/sensitive_string');

module.exports = {
    $id: 'vector_bucket_schema',
    type: 'object',
    // TODO: in the future we might want to add more parameters like vector_db_type and namespace_resource
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
        namespace_resource: {
            type: 'object',
            properties: {
                resource: { objectid: true },
                path: { type: 'string' },
            },
        },
        bucket_claim: { $ref: 'common_api#/definitions/bucket_claim' },
        creation_time: { idate: true},
        tags: {
            $ref: 'common_api#/definitions/tagging',
        },
        deleted: {
            date: true
        },
        vector_policy: {
            $ref: 'common_api#/definitions/bucket_policy'
        },
    }
};
