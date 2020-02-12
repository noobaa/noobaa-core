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
            groups: {
                type: 'array',
                items: {
                    type: 'string'
                }
            },
            timespan: {
                type: 'string',
                enum: [
                    '24_HOURS',
                    '7_DAYS',
                    '4_WEEKS'
                ]
            }
        },
        samples: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'readSize',
                    'writeSize'
                ],
                properties: {
                    timestamp: {
                        type: 'integer'
                    },
                    endpointCount: {
                        type: 'number'
                    },
                    cpuCount: {
                        type: 'number'
                    },
                    cpuUsage: {
                        type: 'number'
                    },
                    memoryUsage: {
                        type: 'number'
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
