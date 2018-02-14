export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'accessKeys',
            'allowedBuckets',
            'defaultResource',
            'externalConnections',
            'hasAccessToAllBuckets',
            'hasLoginAccess',
            'hasS3Access',
            'isOwner',
            'name'
        ],
        properties: {
            accessKeys: {
                type: 'object',
                required: [
                    'accessKey',
                    'secretKey'
                ],
                properties: {
                    accessKey: {
                        type: 'string'
                    },
                    secretKey: {
                        type: 'string'
                    }
                }
            },
            allowedBuckets: {
                type: 'array',
                items: {
                    type: 'string'
                }
            },
            allowedIps: {
                type: 'array',
                items: {
                    type: 'object',
                    required: [
                        'start',
                        'end'
                    ],
                    properties: {
                        start: {
                            type: 'string'
                        },
                        end: {
                            type: 'string'
                        }
                    }
                }
            },
            defaultResource: {
                type: 'string'
            },
            externalConnections: {
                type: 'array',
                items: {
                    type: 'object',
                    required: [
                        'name',
                        'service',
                        'endpoint',
                        'identity',
                        'usage'
                    ],
                    properties: {
                        name: {
                            type: 'string'
                        },
                        service: {
                            type: 'string',
                            enum: [
                                'AWS',
                                'AZURE',
                                'S3_COMPATIBLE',
                                'NET_STORAGE'
                            ]
                        },
                        endpoint: {
                            type: 'string'
                        },
                        identity: {
                            type: 'string'
                        },
                        usage: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: [
                                    'entity',
                                    'externalEntity',
                                    'usageType'
                                ],
                                properties: {
                                    entity: {
                                        type: 'string'
                                    },
                                    externalEntity: {
                                        type: 'string'
                                    },
                                    usageType: {
                                        type: 'string',
                                        enum: [
                                            'CLOUD_SYNC',
                                            'CLOUD_RESOURCE',
                                            'NAMESPACE_RESOURCE'
                                        ]
                                    }
                                }
                            }
                        }
                    }
                }
            },
            hasAccessToAllBuckets: {
                type: 'boolean'
            },
            hasLoginAccess: {
                type: 'boolean'
            },
            hasS3Access: {
                type: 'boolean'
            },
            isOwner: {
                type: 'boolean'
            },
            name: {
                type: 'string'
            }
        }
    }
};
