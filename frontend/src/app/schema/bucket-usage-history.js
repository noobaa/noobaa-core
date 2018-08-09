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
            },
            buckets: {
                type: 'array',
                items: {
                    type:' string'
                }
            }
        },
        samples: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'startTime',
                    'endTime',
                    'readSize',
                    'writeSize'
                ],
                properties: {
                    startTime: {
                        type: 'integer'
                    },
                    endTime: {
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
