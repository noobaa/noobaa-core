/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'certificate_schema',
    type: 'object',
    required: [
        '_id',
        'filename',
        'data'
    ],
    properties: {
        _id: {
            objectid: true
        },
        encoding: {
            type: 'string',
            enum: ['ascii', 'utf8', 'base64', 'hex']
        },
        filename: {
            type: 'string'
        },
        data: {
            type: 'string'
        }
    }
};
