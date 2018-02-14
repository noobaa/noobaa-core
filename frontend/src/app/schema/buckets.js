export default {
    type: 'object',
    additionalProperties: {
        type: 'object',
        required: [
            'name',
            'tierName',
            'mode',
            'storage',
            'data',
            'objectCount',
            'placement',
            'resiliency',
            'resiliencyDriveCountMetric',
            'io'
        ],
        properties: {
            name: {
                type: 'string'
            },
            tierName: {
                type: 'string'
            },
            mode: {
                type: 'string',
                enum: [
                    'NO_RESOURCES',
                    'SPILLOVER_NO_RESOURCES',
                    'NOT_ENOUGH_RESOURCES',
                    'SPILLOVER_NOT_ENOUGH_RESOURCES',
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
                required: [
                    'policyType',
                    'mirrorSets'
                ],
                properties: {
                    policyType: {
                        type: 'string',
                        enum: [
                            'SPREAD',
                            'MIRROR'
                        ]
                    },
                    mirrorSets: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: [
                                'name',
                                'resources'
                            ],
                            properties: {
                                name: {
                                    type: 'string'
                                },
                                resources: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        required: [
                                            'type',
                                            'name',
                                            'usage'
                                        ],
                                        properties: {
                                            type: {
                                                type: 'string',
                                                enum: [
                                                    'HOSTS',
                                                    'CLOUD'
                                                ]
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
                            }
                        }
                    }
                }
            },
            resiliencyDriveCountMetric: {
                type: 'integer'
            },
            resiliency: {
                oneOf: [
                    {
                        type: 'object',
                        required: [
                            'kind',
                            'replicas'
                        ],
                        properties: {
                            kind: {
                                const: 'REPLICATION'
                            },
                            replicas: {
                                type: 'integer'
                            }
                        }
                    },
                    {
                        type: 'object',
                        required: [
                            'kind',
                            'dataFrags',
                            'parityFrags'
                        ],
                        properties: {
                            kind: {
                                const: 'ERASURE_CODING'
                            },
                            dataFrags: {
                                type: 'integer'
                            },
                            parityFrags: {
                                type: 'integer'
                            }
                        }
                    }
                ]
            },
            io: {
                type: 'object',
                required: [
                    'readCount',
                    'writeCount',
                    'lastRead',
                    'lastWrite'
                ],
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
                required: [
                    'type',
                    'name',
                    'usage'
                ],
                properties: {
                    type: {
                        type: 'string',
                        enum: [
                            'INTERNAL'
                        ]
                    },
                    name: {
                        type: 'string'
                    },
                    mirrorSet: {
                        type: 'string'
                    },
                    usage: {
                        $ref: '#/def/common/size'
                    }
                }
            },
            quota: {
                type: 'object',
                required: [
                    'size',
                    'unit'
                ],
                properties: {
                    size: {
                        type: 'integer'
                    },
                    unit: {
                        type: 'string',
                        enum: [
                            'GIGABYTE',
                            'TERABYTE',
                            'PETABYTE'
                        ]
                    }
                }
            },
            cloudSync: {
                type: 'object',
                required: [
                    'state',
                    'policy'
                ],
                properties: {
                    state: {
                        type: 'object',
                        required: [
                            'mode',
                            'isPaused'
                        ],
                        properties: {
                            mode: {
                                type: 'string',
                                enum: [
                                    'PENDING',
                                    'SYNCING',
                                    'UNABLE',
                                    'SYNCED'
                                ]
                            },
                            lastSyncTime: {
                                type: 'integer'
                            },
                            isPaused: {
                                type: 'boolean'
                            }
                        }
                    },
                    policy: {
                        type: 'object',
                        required: [
                            'endpoint',
                            'accessKey',
                            'targetBucket',
                            'frequency',
                            'direction',
                            'syncDeletions'
                        ],
                        properties: {
                            endpoint: {
                                type: 'string'
                            },
                            accessKey: {
                                type: 'string'
                            },
                            targetBucket: {
                                type: 'string'
                            },
                            frequency: {
                                type: 'object',
                                required: [
                                    'value',
                                    'unit'
                                ],
                                properties: {
                                    value: {
                                        type: 'integer'
                                    },
                                    unit: {
                                        type: 'string',
                                        enum: [
                                            'MINUTE',
                                            'HOUR',
                                            'DAY'
                                        ]
                                    }
                                }
                            },
                            direction: {
                                type: 'string',
                                enum: [
                                    'SOURCE_TO_TARGET',
                                    'TARGET_TO_SOURCE',
                                    'BI_DIRECTIONAL'
                                ]
                            },
                            syncDeletions: {
                                type: 'boolean'
                            }
                        }
                    }
                }
            },
            triggers: {
                type: 'object',
                additionalProperties: {
                    type: 'object',
                    required: [
                        'id',
                        'mode',
                        'event',
                        'func',
                        'prefix',
                        'suffix'
                    ],
                    properties: {
                        id: {
                            type: 'string'
                        },
                        mode: {
                            type: 'string',
                            enum: [
                                'OPTIMAL',
                                'MISSING_PERMISSIONS',
                                'DISABLED'
                            ]
                        },
                        event: {
                            type:' string',
                            enum: [
                                'ObjectCreated',
                                'ObjectRemoved'
                            ]
                        },
                        func: {
                            type: 'object',
                            required: [
                                'name',
                                'version'
                            ],
                            properties: {
                                name: {
                                    type: 'string'
                                },
                                version: {
                                    type: 'string'
                                }
                            }
                        },
                        prefix: {
                            type: 'string'
                        },
                        suffix: {
                            type: 'string'
                        },
                        lastRun: {
                            type:' integer'
                        }
                    }
                }
            },
            undeletable: {
                type: 'string',
                enum: [
                    'LAST_BUCKET',
                    'NOT_EMPTY'
                ]
            }
        }
    }
};
