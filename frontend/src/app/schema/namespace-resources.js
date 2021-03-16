/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'mode'
        ],
        properties: {
            name: {
                type: 'string'
            },
            mode: {
                type: 'string',
                enum: [
                    'OPTIMAL',
                    'STORAGE_NOT_EXIST',
                    'AUTH_FAILED',
                    'IO_ERRORS'
                ]
            },
            service: {
                type: 'string',
                enum: [
                    'AWS',
                    'AZURE',
                    'S3_COMPATIBLE',
                    'NET_STORAGE',
                    'IBM_COS'
                ]
            },
            target: {
                type: 'string'
            },
            undeletable: {
                type: 'string',
                enum: [
                    'IN_USE'
                ]
            }
        }
    }
};
