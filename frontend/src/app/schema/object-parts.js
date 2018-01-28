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
            type: 'object',
            required: [
                'bucket',
                'key',
                'limit',
                'skip'
            ],
            properties: {
                bucket: {
                    type: 'string'
                },
                key: {
                    type: 'string'
                },
                limit: {
                    type: 'integer'
                },
                skip: {
                    type: 'integer'
                }
            }
        },
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'seq',
                    'mode',
                    'size',
                    'blocks'
                ],
                properties: {
                    seq: {
                        type: 'integer'
                    },
                    mode: {
                        type: 'string',
                        enum: [
                            'AVAILABLE',
                            'BUILDING',
                            'UNAVAILABLE'
                        ]
                    },
                    size: {
                        $ref: '#/def/common/size'
                    },
                    blocks: {
                        type: 'array',
                        required: [
                            'kind',
                            'mirrorSet',
                            'mode',
                            'storage'
                        ],
                        items: {
                            type: 'object',
                            properties: {
                                kind: {
                                    type: 'string',
                                    enum: [
                                        'REPLICA',
                                        'DATA',
                                        'PARITY'
                                    ]
                                },
                                seq: {
                                    type: 'integer'
                                },
                                mirrorSet: {
                                    type: 'string'
                                },
                                mode: {
                                    type: 'string',
                                    enum: [
                                        'HEALTHY',
                                        'NOT_ACCESSIBLE'
                                    ]
                                },
                                storage: {
                                    oneOf: [
                                        {
                                            type: 'object',
                                            required: [
                                                'kind',
                                                'pool',
                                                'host'
                                            ],
                                            properties: {
                                                kind: {
                                                    const: 'HOSTS'
                                                },
                                                pool: {
                                                    type: 'string'
                                                },
                                                host: {
                                                    type: 'string'
                                                }
                                            }
                                        },
                                        {
                                            type: 'object',
                                            required: [
                                                'kind',
                                                'resource'
                                            ],
                                            properties: {
                                                kind: {
                                                    const: 'CLOUD'
                                                },
                                                resource: {
                                                    type: 'string'
                                                }
                                            }
                                        },
                                        {
                                            type: 'object',
                                            required: [
                                                'kind'
                                            ],
                                            properties: {
                                                kind: {
                                                    const: 'INTERNAL'
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        }
    }
};
