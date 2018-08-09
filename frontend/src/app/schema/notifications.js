/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    required: [
        'nextId',
        'list'
    ],
    properties: {
        nextId: {
            type: 'number'
        },
        list: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'id',
                    'message',
                    'severity'
                ],
                properties: {
                    id: {
                        type: 'number'
                    },
                    message: {
                        type: 'string'
                    },
                    severity: {
                        type: 'string',
                        enum: [
                            'info',
                            'success',
                            'warning',
                            'error'
                        ]
                    }
                }
            }
        }
    }
};
