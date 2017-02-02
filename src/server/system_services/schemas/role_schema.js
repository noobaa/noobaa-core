/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'role_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'account',
        'role'
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        deleted: {
            format: 'date'
        },
        system: {
            format: 'objectid'
        },
        account: {
            format: 'objectid'
        },
        role: {
            type: 'string',
            enum: ['admin', 'user', 'viewer']
        },
    }
};
