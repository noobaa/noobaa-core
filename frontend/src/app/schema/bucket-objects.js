export default {
    type: 'object',
    required: [
        'queries',
        'objects'
    ],
    properties: {
        queries: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                required: [
                    'fetching',
                    'timestamp',
                    'result'
                ],
                properties: {
                    fetching: {
                        type: 'boolean'
                    },
                    timestamp: {
                        instanceof: 'Date'
                    },
                    result: {
                        type: 'object',
                        required: [
                            'counters',
                            'objects'
                        ],
                        properties: {
                            counters: {
                                type: 'object',
                                required: [
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
                                type: 'array',
                                items: {
                                    type: 'string'
                                }
                            }
                        }
                    }
                }
            }
        },
        objects: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                required: [
                    'bucket',
                    'key',
                    'mode'
                ],
                properties: {
                    key: {
                        type: 'string'
                    },
                    bucket: {
                        type: 'string'
                    },
                    mode: {
                        type: 'string',
                        enum: ['COMPLETED', 'UPLOADING']
                    },
                    uploadId: {
                        type: 'string'
                    },
                    size: {
                        type: 'integer'
                    }
                }
            }
        }
    }
};
