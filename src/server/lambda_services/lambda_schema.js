/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'lambda_schema',
    type: 'object',
    required: [
        '_id',
        'name',
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        name: {
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
        role: {
            type: 'string'
        },
        handler: {
            type: 'string'
        },
        description: {
            type: 'string'
        },
        memory_size: {
            type: 'integer'
        },
        timeout: {
            type: 'integer'
        },
        code: {
            type: 'object',
            properties: {
                zipfile: {
                    type: 'string'
                },
                s3_bucket: {
                    type: 'string'
                },
                s3_key: {
                    type: 'string'
                },
                s3_obj_version: {
                    type: 'string'
                },
                s3_endpoint: {
                    type: 'string'
                },
                url: {
                    type: 'string'
                },
            }
        },
    }
};
