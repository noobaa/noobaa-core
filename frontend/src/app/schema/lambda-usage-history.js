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
        data: {
            type: 'object',
            required: [
                'stats',
                'slices'
            ],
            properties: {
                stats: {
                    $ref: '#/def/common/lambdaFuncStats'
                },
                slices: {
                    type: 'array',
                    items: {
                        $ref: '#/def/common/lambdaFuncStats'
                    }
                }
            }
        }
    }
};
