/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    required: [
        'host',
        'partCount',
        'fetching',
        'error'
    ],
    properties: {
        host: {
            type: 'string'
        },
        parts: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'mode',
                    'object',
                    'bucket',
                    'start',
                    'end'
                ],
                properties: {
                    mode: {
                        type: 'string',
                        enum: [
                            'AVAILABLE',
                            'BUILDING',
                            'UNAVAILABLE'
                        ]
                    },
                    bucket: {
                        type: 'string'
                    },
                    object: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    },
                    start: {
                        type: 'integer'
                    },
                    end: {
                        type: 'integer'
                    }
                }
            }
        },
        skip: {
            type: 'integer'
        },
        limit: {
            type: 'integer'
        },
        partCount: {
            type: 'integer'
        },
        fetching: {
            type: 'boolean'
        },
        error: {
            type: 'boolean'
        }
    }
};
