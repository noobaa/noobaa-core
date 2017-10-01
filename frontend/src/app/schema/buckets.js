export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'mode',
            'storage',
            'data',
            'objectCount',
            'placement',
            'io'
        ],
        properties: {
            name: {
                type: 'string',
            },
            mode: {
                type: 'string',
                enum: [
                    'NO_RESOURCES',
                    'SPILLOVER_NO_RESOURCES',
                    'NOT_ENOUGH_HEALTHY_RESOURCES',
                    'SPILLOVER_NOT_ENOUGH_HEALTHY_RESOURCES',
                    'NO_CAPACITY',
                    'SPILLOVER_NO_CAPACITY',
                    'LOW_CAPACITY',
                    'APPROUCHING_QOUTA',
                    'EXCEEDING_QOUTA',
                    'OPTIMAL'
                ]
            },
            storage: {
                $ref: '#/def/common/storage'
            },
            data: {
                type: 'object',
                properties: {
                    lastUpdate: {
                        type: 'integer'
                    },
                    size: {
                        $ref: '#/def/common/size'
                    },
                    sizeReduced: {
                        $ref: '#/def/common/size'
                    },
                    availableForUpload: {
                        $ref: '#/def/common/size'
                    },
                    availableForSpillover: {
                        $ref: '#/def/common/size'
                    }
                }
            },
            objectCount: {
                type: 'integer'
            },
            placement: {
                type: 'object',
                required: ['tierName', 'policyType', 'resources'],
                properties: {
                    tierName: {
                        type: 'string'
                    },
                    policyType: {
                        type: 'string',
                        enum: ['SPREAD', 'MIRROR']
                    },
                    resources: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['type', 'name', 'usage'],
                            properties: {
                                type: {
                                    type: 'string',
                                    enum: ['HOSTS', 'CLOUD']
                                },
                                name: {
                                    type: 'string'
                                },
                                usage: {
                                    $ref: '#/def/common/size'
                                }
                            }
                        }
                    }
                },
            },
            io: {
                type: 'object',
                required: [ 'readCount', 'writeCount', 'lastRead', 'lastWrite' ],
                properties: {
                    readCount: {
                        type: 'integer'
                    },
                    lastRead: {
                        type: 'integer'
                    },
                    writeCount: {
                        type: 'integer'
                    },
                    lastWrite: {
                        type: 'integer'
                    }
                }
            },
            spillover: {
                type: 'object',
                required: ['type', 'name', 'usage'],
                properties: {
                    type: {
                        type: 'string',
                        enum: ['INTERNAL']
                    },
                    name: {
                        type: 'string'
                    },
                    usage: {
                        $ref: '#/def/common/size'
                    }
                }
            },
            quota: {
                type: 'object',
                required: ['size', 'unit'],
                properties: {
                    size: {
                        type: 'integer'
                    },
                    unit: {
                        type: 'string',
                        enum: ['GIGABYTE', 'TERABYTE', 'PETABYTE']
                    },
                }
            },
            cloudSync: {
                type: 'object',
                required: ['state'],
                properties: {
                    state: {
                        type: 'string',
                        enum: ['PENDING', 'SYNCING', 'UNABLE', 'SYNCED']
                    }
                }
            },
            undeletable: {
                type: 'string',
                enum: ['LAST_BUCKET', 'NOT_EMPTY'],
            }
        }
    }
};
