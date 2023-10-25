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
    }
};
