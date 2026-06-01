/* Copyright (C) 2026 NooBaa */
'use strict';

module.exports = {
    $id: 'iam_role_schema',
    type: 'object',
    required: [
        '_id',
        'owner',
        'name',
        'iam_path',
        'assume_role_policy_document',
        'creation_date',
    ],
    properties: {
        _id: {
            objectid: true
        },
        deleted: {
            date: true
        },
        owner: {
            objectid: true
        },
        name: {
            type: 'string'
        },
        iam_path: {
            type: 'string'
        },
        description: {
            type: 'string'
        },
        max_session_duration: {
            type: 'integer',
            minimum: 3600,
            maximum: 43200
        },
        assume_role_policy_document: {
            $ref: 'common_api#/definitions/iam_trust_policy_document'
        },
        iam_role_policies: {
            type: 'array',
            items: {
                $ref: 'common_api#/definitions/iam_user_policy',
            }
        },
        creation_date: {
            idate: true
        },
    }
};
