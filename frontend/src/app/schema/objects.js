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

                            },
                            emptyReason: {
                                type: 'string',
                                enum: [
                                    'NO_MATCHING_KEYS',
                                    'NO_RESULTS',
                                    'NO_OBJECTS',
                                    'NO_LATEST',
                                    'NO_UPLOADS'
                                ]
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
                    'bucket',
                    'key',
                    'versionId',
                    'latestVersion',
                    'deleteMarker',
                    'mode',
                    'size',
                    'contentType',
                    'createTime',
                    'lastReadTime',
                    'readCount',
                    's3SignedUrl'
                ],
                properties: {
                    bucket: {
                        type: 'string'
                    },
                    key: {
                        type: 'string'
                    },
                    versionId: {
                        type: 'string'
                    },
                    latestVersion: {
                        type: 'boolean'
                    },
                    deleteMarker: {
                        type: 'boolean'
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
