/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'func_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'pools',
        'name',
        'exec_account',
        'version',
        'runtime',
        'handler',
        'last_modified',
        'last_modifier',
        'code_size',
        'code_sha256',
        'code',
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
        pools: {
            type: 'array',
            items: {
                objectid: true
            }
        },
        name: {
            type: 'string'
        },
        exec_account: {
            objectid: true
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
            type: 'string'
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
            date: true
        },
        last_modifier: {
            objectid: true
        },
        resource_name: {
            type: 'string'
        },
        code_size: {
            type: 'integer'
        },
        code_sha256: {
            type: 'string'
        },
        code: {
            type: 'string'
        }
    }
};
