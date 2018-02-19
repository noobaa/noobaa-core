const storageNode = {
    type: 'object',
    required: [
        'name',
        'mode',
        'storage',
        'drive',
        'mount',
        'readLatency',
        'writeLatency',
        'untrusted'
    ],
    properties: {
        name: {
            type: 'string'
        },
        mode: {
            type: 'string',
            enum: [
                'OFFLINE',
                'UNTRUSTED',
                'INITIALIZING',
                'DELETING',
                'DECOMMISSIONING',
                'DECOMMISSIONED',
                'MIGRATING',
                'N2N_ERRORS',
                'GATEWAY_ERRORS',
                'IO_ERRORS',
                'LOW_CAPACITY',
                'NO_CAPACITY',
                'N2N_PORTS_BLOCKED',
                'STORAGE_NOT_EXIST',
                'OPTIMAL'
            ]
        },
        storage: {
            $ref: '#/def/common/storage'
        },
        drive: {
            type: 'string'
        },
        mount: {
            type: 'string'
        },
        readLatency: {
            type: 'number'
        },
        writeLatency: {
            type: 'number'
        },
        activity: {
            type: 'object',
            required: [
                'kind',
                'progress',
                'stage'
            ],
            properties: {
                kind: {
                    type: 'string',
                    enum: [
                        'RESTORING',
                        'MIGRATING',
                        'DECOMMISSIONING',
                        'DELETING'
                    ]
                },
                progress: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1
                },
                stage: {
                    type: 'string',
                    enum: [
                        'OFFLINE_GRACE',
                        'REBUILDING',
                        'WIPING'
                    ]
                }
            }
        },
        untrusted: {
            type: 'array',
            items: {
                type: 'array',
                items: {
                    type: 'object',
                    required: [
                        'reason',
                        'time'
                    ],
                    properties: {
                        reason: {
                            type: 'string',
                            enum: [
                                'CORRUPTION',
                                'TEMPERING'
                            ]
                        },
                        time: {
                            type: 'integer'
                        }
                    }
                }
            }
        }
    }
};

const host = {
    type: 'object',
    required: [
        'name',
        'hostname',
        'pool',
        'mode',
        'version',
        'ip',
        'protocol',
        'endpoint',
        'rpcAddress',
        'lastCommunication',
        'rtt',
        'storage',
        'trusted',
        'activities',
        'services',
        'upTime',
        'os',
        'cpus',
        'memory',
        'debugMode',
        'diagnostics'
    ],
    properties: {
        name: {
            type: 'string'
        },
        hostname: {
            type: 'string'
        },
        pool: {
            type: 'string'
        },
        suggestedPool: {
            type: 'string'
        },
        mode: {
            type: 'string',
            enum: [
                'DECOMMISSIONED',
                'OFFLINE',
                'S3_OFFLINE',
                'STORAGE_OFFLINE',
                'UNTRUSTED',
                'STORAGE_NOT_EXIST',
                'DETENTION',
                'INITIALIZING',
                'DECOMMISSIONING',
                'MIGRATING',
                'IN_PROCESS',
                'SOME_STORAGE_MIGRATING',
                'SOME_STORAGE_INITIALIZING',
                'SOME_STORAGE_DECOMMISSIONING',
                'DELETING',
                'SOME_STORAGE_OFFLINE',
                'SOME_STORAGE_NOT_EXIST',
                'SOME_STORAGE_DETENTION',
                'NO_CAPACITY',
                'LOW_CAPACITY',
                'HTTP_SRV_ERRORS',
                'HAS_ERRORS',
                'HAS_ISSUES',
                'N2N_PORTS_BLOCKED',
                'OPTIMAL'
            ]
        },
        version: {
            type: 'string'
        },
        ip: {
            type: 'string'
        },
        ports: {
            type: 'object',
            required: [
                'max',
                'min'
            ],
            properties: {
                max: {
                    type: 'integer'
                },
                min: {
                    type: 'integer'
                }
            }
        },
        protocol: {
            type: 'string'
        },
        endpoint: {
            type: 'string'
        },
        rpcAddress: {
            type: 'string'
        },
        lastCommunication: {
            type: 'integer'
        },
        rtt: {
            type: 'number'
        },
        storage: {
            $ref: '#/def/common/storage'
        },
        trusted: {
            type: 'boolean'
        },
        activities: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'kind',
                    'nodeCount',
                    'progress'
                ],
                properties: {
                    kind: {
                        type: 'string',
                        enum: [
                            'RESTORING',
                            'MIGRATING',
                            'DECOMMISSIONING',
                            'DELETING'
                        ]
                    },
                    nodeCount: {
                        type: 'integer'
                    },
                    progress: {
                        type: 'number',
                        minimum: 0,
                        maximum: 1
                    },
                    eta: {
                        type: 'integer'
                    }
                }
            }
        },
        services: {
            type: 'object',
            required: [
                'storage',
                'endpoint'
            ],
            properties: {
                endpoint: {
                    type: 'object',
                    required: [
                        'enabled',
                        'mode'
                    ],
                    properties: {
                        enabled: {
                            type: 'boolean'
                        },
                        mode: {
                            type: 'string',
                            enum: [
                                'OFFLINE',
                                'DECOMMISSIONED',
                                'HTTP_SRV_ERRORS',
                                'INITIALIZING',
                                'DELETING',
                                'OPTIMAL'
                            ]
                        },
                        usage: {
                            type: 'object',
                            required: [
                                'last7Days',
                                'lastRead',
                                'lastWrite'
                            ],
                            properties: {
                                last7Days: {
                                    type: 'object',
                                    required: [
                                        'bytesRead',
                                        'bytesWritten'
                                    ],
                                    properties: {
                                        bytesRead: {
                                            type: 'integer'
                                        },
                                        bytesWritten: {
                                            type: 'integer'
                                        }
                                    }
                                },
                                lastRead: {
                                    type: 'integer'
                                },
                                lastWrite: {
                                    type: 'integer'
                                }
                            }
                        }
                    }
                },
                storage: {
                    type: 'object',
                    required: [
                        'enabled',
                        'mode',
                        'nodes'
                    ],
                    properties: {
                        enabled: {
                            type: 'boolean'
                        },
                        mode: {
                            type: 'string',
                            enum: [
                                'DECOMMISSIONED',
                                'OFFLINE',
                                'UNTRUSTED',
                                'STORAGE_NOT_EXIST',
                                'DETENTION',
                                'INITIALIZING',
                                'DELETING',
                                'DECOMMISSIONING',
                                'MIGRATING',
                                'IN_PROCESS',
                                'SOME_STORAGE_MIGRATING',
                                'SOME_STORAGE_INITIALIZING',
                                'SOME_STORAGE_DECOMMISSIONING',
                                'SOME_STORAGE_OFFLINE',
                                'SOME_STORAGE_NOT_EXIST',
                                'SOME_STORAGE_DETENTION',
                                'NO_CAPACITY',
                                'LOW_CAPACITY',
                                'N2N_PORTS_BLOCKED',
                                'OPTIMAL'
                            ]
                        },
                        nodes: {
                            type: 'array',
                            items: storageNode
                        }
                    }
                }
            }
        },
        upTime: {
            type: 'integer'
        },
        os: {
            type: 'string'
        },
        cpus: {
            type: 'object',
            required: [
                'units',
                'usedByOther',
                'usedByNoobaa'
            ],
            properties: {
                units: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: [
                            'model',
                            'speed'
                        ],
                        properties: {
                            model: {
                                type: 'string'
                            },
                            speed: {
                                type: 'integer'
                            }
                        }
                    }
                },
                usedByOther: {
                    type: 'number'
                },
                usedByNoobaa: {
                    type: 'number'
                }
            }
        },
        memory: {
            type: 'object',
            required: [
                'free',
                'usedByNoobaa',
                'usedByOther'
            ],
            properties: {
                free: {
                    type: 'integer'
                },
                usedByNoobaa: {
                    type: 'integer'
                },
                usedByOther: {
                    type: 'integer'
                }
            }
        },
        debugMode: {
            type: 'object',
            required: [
                'state'
            ],
            properties: {
                state: {
                    type: 'boolean'
                },
                timeLeft: {
                    type: 'integer'
                }
            }
        },
        diagnostics: {
            type: 'object',
            required: [
                'collecting',
                'error',
                'packageUri'
            ],
            properties: {
                collecting: {
                    type: 'boolean'
                },
                error: {
                    type: 'boolean'
                },
                packageUri: {
                    type: 'string'
                }
            }
        }
    }
};

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
                                    'byMode',
                                    'nonPaginated'
                                ],
                                properties: {
                                    byMode: {
                                        type: 'object',
                                        properties: {
                                            DECOMMISSIONED: {
                                                type: 'integer'
                                            },
                                            OFFLINE: {
                                                type: 'integer'
                                            },
                                            S3_OFFLINE: {
                                                type: 'integer'
                                            },
                                            STORAGE_OFFLINE: {
                                                type: 'integer'
                                            },
                                            UNTRUSTED: {
                                                type: 'integer'
                                            },
                                            STORAGE_NOT_EXIST: {
                                                type: 'integer'
                                            },
                                            DETENTION: {
                                                type: 'integer'
                                            },
                                            INITIALIZING: {
                                                type: 'integer'
                                            },
                                            DECOMMISSIONING: {
                                                type: 'integer'
                                            },
                                            MIGRATING: {
                                                type: 'integer'
                                            },
                                            IN_PROCESS: {
                                                type: 'integer'
                                            },
                                            SOME_STORAGE_MIGRATING: {
                                                type: 'integer'
                                            },
                                            SOME_STORAGE_INITIALIZING: {
                                                type: 'integer'
                                            },
                                            SOME_STORAGE_DECOMMISSIONING: {
                                                type: 'integer'
                                            },
                                            DELETING: {
                                                type: 'integer'
                                            },
                                            SOME_STORAGE_OFFLINE: {
                                                type: 'integer'
                                            },
                                            SOME_STORAGE_NOT_EXIST: {
                                                type: 'integer'
                                            },
                                            SOME_STORAGE_DETENTION: {
                                                type: 'integer'
                                            },
                                            NO_CAPACITY: {
                                                type: 'integer'
                                            },
                                            LOW_CAPACITY: {
                                                type: 'integer'
                                            },
                                            HTTP_SRV_ERRORS: {
                                                type: 'integer'
                                            },
                                            HAS_ERRORS: {
                                                type: 'integer'
                                            },
                                            HAS_ISSUES: {
                                                type: 'integer'
                                            },
                                            N2N_PORTS_BLOCKED: {
                                                type: 'integer'
                                            },
                                            OPTIMAL: {
                                                type: 'integer'
                                            }
                                        }
                                    },
                                    nonPaginated: {
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
            additionalProperties: host
        }
    }
};
