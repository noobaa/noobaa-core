export default {
    type: 'object',
    required: [
        'counters',
        'objects',
    ],
    properties: {
        counters: {
            type: 'object',
            required: [
                'nonPaginated',
                'completed',
                'uploading'
            ],
            properties: {
                nonPaginated: {
                    type: 'number'
                },
                completed: {
                    type: 'number'
                },
                uploading: {
                    type: 'number'
                }
            }
        },
        objects: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                required: [
                    'objId',
                    'bucket',
                    'key',
                    'size',
                    'contentType',
                    'createTime'
                ],
                properties: {
                    objId: {
                        type: 'string'
                    },
                    bucket: {
                        type: 'string'
                    },
                    key: {
                        type: 'string'
                    },
                    size: {
                        type: 'integer',
                    },
                    contentType: {
                        type: 'string',
                    },
                    createTime: {
                        format: 'idate'
                    }
                }
            }
        },
    }
};
