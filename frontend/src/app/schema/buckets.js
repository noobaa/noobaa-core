const resiliencyMode = {
    type: 'string',
    enum: [
        'NOT_ENOUGH_RESOURCES',
        'RISKY_TOLERANCE',
        'DATA_ACTIVITY',
        'OPTIMAL'
    ]
};

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
                    'OPTIMAL',
                    'SPILLOVER_ISSUES',
                    'DATA_ACTIVITY',
                    'APPROUCHING_QUOTA',
                    'LOW_CAPACITY',
                    'RISKY_TOLERANCE',
                    'SPILLOVER_NO_CAPACITY',
                    'SPILLOVER_NO_RESOURCES',
                    'SPILLOVER_NOT_ENOUGH_RESOURCES',
                    'SPILLOVER_NOT_ENOUGH_HEALTHY_RESOURCES',
                    'SPILLING_BACK',
                    'NO_CAPACITY_SPILLOVER_UNSERVICEABLE',
                    'NOT_ENOUGH_HEALTHY_RESOURCES_SPILLOVER_UNSERVICEABLE',
                    'NOT_ENOUGH_RESOURCES_SPILLOVER_UNSERVICEABLE',
                    'NO_RESOURCES_SPILLOVER_UNSERVICEABLE',
                    'EXCEEDING_QUOTA',
                    'NO_CAPACITY',
                    'NOT_ENOUGH_HEALTHY_RESOURCES',
                    'NOT_ENOUGH_RESOURCES',
                    'NO_RESOURCES'
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
                    'mode',
                    'policyType',
                    'mirrorSets'
                ],
                properties: {
                    mode: {
                        type: 'string',
                        enum: [
                            'NO_RESOURCES',
                            'NOT_ENOUGH_RESOURCES',
                            'NOT_ENOUGH_HEALTHY_RESOURCES',
                            'NO_CAPACITY',
                            'RISKY_TOLERANCE',
                            'SPILLING_BACK',
                            'LOW_CAPACITY',
                            'DATA_ACTIVITY',
                            'OPTIMAL'
                        ]
                    },
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
            resiliency: {
                oneOf: [
                    {
                        type: 'object',
                        required: [
                            'mode',
                            'kind',
                            'replicas'
                        ],
                        properties: {
                            mode: resiliencyMode,
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
                            'mode',
                            'kind',
                            'dataFrags',
                            'parityFrags'
                        ],
                        properties: {
                            mode: resiliencyMode,
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
            versioning: {
                type: 'object',
                required: [
                    'mode'
                ],
                properties: {
                    mode: {
                        type: 'string',
                        enum: [
                            'DISABLED',
                            'SUSPENDED',
                            'ENABLED'
                        ]
                    }
                }
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
                    'mode',
                    'name',
                    'mirrorSet',
                    'usage'
                ],
                properties: {
                    type: {
                        type: 'string',
                        enum: [
                            'INTERNAL',
                            'CLOUD',
                            'HOSTS'
                        ]
                    },
                    mode: {
                        type: 'string',
                        enum: [
                            'SPILLOVER_ERRORS',
                            'SPILLOVER_ISSUES',
                            'SPILLING_BACK',
                            'OPTIMAL'
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
                    'mode',
                    'size',
                    'unit'
                ],
                properties: {
                    mode: {
                        type: 'string',
                        enum: [
                            'EXCEEDING_QUOTA',
                            'APPROUCHING_QUOTA',
                            'OPTIMAL'
                        ]
                    },
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
            failureTolerance: {
                type: 'object',
                required: [
                    'hosts',
                    'nodes'
                ],
                properties: {
                    hosts: {
                        type: 'integer'
                    },
                    nodes: {
                        type: 'integer'
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
