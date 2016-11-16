/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'lambda_func_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'pools',
        'name',
        'version',
        'runtime',
        'handler',
        'last_modified',
        'code_size',
        'code_sha256',
        'code_gridfs_id',
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
                'nodejs4.3',
                // 'nodejs',
                // 'python2.7',
                // 'java8',
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
