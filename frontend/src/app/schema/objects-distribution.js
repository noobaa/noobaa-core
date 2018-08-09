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
        buckets: {
            type: 'object',
            additionalProperties: {
                type: 'array',
                items: {
                    type: 'object',
                    required: [
                        'size',
                        'count'
                    ],
                    properties: {
                        size: {
                            $ref: '#/def/common/size'
                        },
                        count: {
                            type: 'integer'
                        }
                    }
                }
            }
        }
    }
};
