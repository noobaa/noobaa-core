/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'accessKeys',
            'allowedBuckets',
            'canCreateBuckets',
            'externalConnections',
            'isAdmin',
            'isOwner',
            'name',
            'roles'
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
            canCreateBuckets: {
                type: 'boolean'
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
                                'S3_V2_COMPATIBLE',
                                'S3_V4_COMPATIBLE',
                                'NET_STORAGE',
                                'GOOGLE',
                                'FLASHBLADE',
                                'IBM_COS'
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
            undeletable: {
                type: 'string',
                enum: [
                    'OWNER',
                    'OWN_BUCKET'
                ]
            },
            hasAccessToAllBuckets: {
                type: 'boolean'
            },
            isAdmin: {
                type: 'boolean'
            },
            isOwner: {
                type: 'boolean'
            },
            name: {
                type: 'string'
            },
            roles: {
                type: 'array',
                items: {
                    type: 'string'
                }
            }
        }
    }
};
