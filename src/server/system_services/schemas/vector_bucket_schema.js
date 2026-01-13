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
        creation_time: {
            idate: true
        },
        deleted: {
            date: true
        },
    }
};
