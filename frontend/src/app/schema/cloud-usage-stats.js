/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    required: [
        'fetching',
        'error'
    ],
    properties: {
        fetching: {
            type: 'boolean'
        },
        error: {
            type: 'boolean'
        },
        query: {
            duration: {
                type: 'string',
                enum: [
                    'DAY',
                    'WEEK',
                    'MONTH'
                ]
            }
        },
        usage: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                required: [
                    'readCount',
                    'writeCount',
                    'readSize',
                    'writeSize'
                ],
                properties: {
                    readCount: {
                        type: 'integer'
                    },
                    writeCount: {
                        type: 'integer'
                    },
                    readSize: {
                        $ref: '#/def/common/size'
                    },
                    writeSize: {
                        $ref: '#/def/common/size'
                    }
                }
            }
        }
    }
};
