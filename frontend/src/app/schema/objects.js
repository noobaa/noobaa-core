export default {
    type: 'object',
    required: [
        'views',
        'queries',
        'items'
    ],
    properties: {
        views: {
            type: 'object',
            additionalProperties: {
                type: 'integer'
            }
        },
        queries: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                required: [
                    'timestamp',
                    'fetching',
                    'error'
                ],
                properties: {
                    timestamp: {
                        type: 'integer'
                    },
                    fetching: {
                        type: 'boolean'
                    },
                    error: {
                        type: 'boolean'
                    },
                    result: {
                        type: 'object',
                        required: [
                            'counters',
                            'items'
                        ],
                        properties: {
                            counters: {
                                type: 'object',
                                required: [
                                    'optimal',
                                    'uploading'
                                ],
                                properties: {
                                    optimal: {
                                        type: 'integer'
                                    },
                                    uploading: {
                                        type: 'integer'
                                    }
                                }
                            },
                            items: {
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
        items: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                required: [
                    'key',
                    'bucket',
                    'mode',
                    'size',
                    'contentType',
                    'createTime',
                    'lastReadTime',
                    'readCount',
                    'partCount',
                    's3SignedUrl'
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
                        enum: [
                            'OPTIMAL',
                            'UPLOADING'
                        ]
                    },
                    uploadId: {
                        type: 'string'
                    },
                    size: {
                        type: 'object',
                        required: [
                            'original'
                        ],
                        properties: {
                            original: {
                                $ref: '#/def/common/size'
                            },
                            onDisk: {
                                $ref: '#/def/common/size'
                            }
                        }
                    },
                    contentType: {
                        type: 'string'
                    },
                    createTime: {
                        type: 'integer'
                    },
                    lastReadTime: {
                        type: 'integer'
                    },
                    readCount: {
                        type: 'integer'
                    },
                    partCount: {
                        type: 'integer'
                    },
                    s3SignedUrl:  {
                        type: 'string'
                    }
                }
            }
        }
    }
};
