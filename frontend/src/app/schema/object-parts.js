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
            type: 'object',
            required: [
                'bucket',
                'key',
                'version',
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
                version: {
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
                        items: {
                            type: 'object',
                            required: [
                                'kind',
                                'mode'
                            ],
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
                                mode: {
                                    type: 'string',
                                    enum: [
                                        'NOT_ACCESSIBLE',
                                        'CANNOT_BE_DELETED',
                                        'WAITING_FOR_ALLOCATION',
                                        'WAITING_FOR_DELETE',
                                        'HEALTHY'
                                    ]
                                },
                                mirrorSet: {
                                    type: 'string'
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
                                                    type: 'string',
                                                    enum: [
                                                        'INTERNAL_STORAGE',
                                                        'NOT_ALLOCATED'
                                                    ]
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
