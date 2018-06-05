export default {
    type: 'object',
    properties: {
        objects: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'id',
                    'name',
                    'bucket',
                    'size',
                    'loaded',
                    'completed',
                    'archived'
                ],
                properties: {
                    id: {
                        type: 'string'
                    },
                    name: {
                        type: 'string'
                    },
                    bucket: {
                        type: 'string'
                    },
                    versionId: {
                        type: 'string'
                    },
                    size: {
                        type: 'integer'
                    },
                    loaded: {
                        type: 'integer'
                    },
                    completed: {
                        type: 'boolean'
                    },
                    archived: {
                        type: 'boolean'
                    },
                    error: {
                        type: 'object',
                        required: [
                            'code',
                            'message'
                        ],
                        properties: {
                            code: {
                                type: 'string'
                            },
                            message: {
                                type: 'string'
                            }
                        }
                    }
                }
            }
        },
        lastUpload: {
            type: 'object',
            required: [
                'time',
                'objectCount'
            ],
            properties: {
                time: {
                    type: 'integer'
                },
                objectCount: {
                    type: 'integer'
                }
            }
        },
        stats: {
            type: 'object',
            required: [
                'count',
                'uploading',
                'uploaded',
                'failed',
                'batchSize',
                'batchLoaded'
            ],
            properties: {
                count: {
                    type: 'integer'
                },
                uploading: {
                    type: 'integer'
                },
                uploaded: {
                    type: 'integer'
                },
                failed: {
                    type: 'integer'
                },
                batchSize: {
                    type: 'integer'
                },
                batchLoaded: {
                    type: 'integer'
                }
            }
        }
    }
};
