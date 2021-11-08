/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'role_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'account',
        'role'
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
        role: {
            type: 'string',
            enum: ['admin', 'user', 'operator']
        },
    }
};
