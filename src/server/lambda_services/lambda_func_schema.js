/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'lambda_func_schema',
    type: 'object',
    required: [
        '_id',
        'name',
        'system',
        'last_modified',
        'code',
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
        pools: {
            type: 'array',
            items: {
                format: 'objectid'
            }
        },
        name: {
            type: 'string'
        },
        version: {
            type: 'string'
        },
        description: {
            type: 'string'
        },
        role: {
            type: 'string'
        },
        runtime: {
            type: 'string',
            enum: [
                'nodejs6',
                // 'nodejs',
                // 'nodejs4.3',
                // 'java8',
                // 'python2.7',
            ]
        },
        handler: {
            type: 'string'
        },
        memory_size: {
            type: 'integer'
        },
        timeout: {
            type: 'integer'
        },
        last_modified: {
            format: 'date'
        },
        code_size: {
            type: 'integer'
        },
        code_sha256: {
            type: 'string'
        },
        code_gridfs_id: {
            format: 'objectid'
        },
    }
};
