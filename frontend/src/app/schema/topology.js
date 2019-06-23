/* Copyright (C) 2016 NooBaa */

const server = {
    type: 'object',
    required: [
        'hostname',
        'secret',
        'mode',
        'version',
        'addresses',
        'timezone',
        'locationTag',
        'storage',
        'memory',
        'cpus',
        'clockSkew',
        'dns',
        'phonehome',
        'clusterConnectivity',
        'debugMode',
        'isMaster'
    ],
    properties: {
        secret: {
            type: 'string'
        },
        hostname: {
            type: 'string'
        },
        mode: {
            type: 'string',
            enum: [
                'CONNECTED',
                'DISCONNECTED',
                'IN_PROGRESS'
            ]
        },
        version: {
            type: 'string'
        },
        addresses: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'ip',
                    'collision'
                ],
                properties: {
                    ip: {
                        type: 'string'
                    },
                    collision: {
                        type: 'boolean'
                    }
                }
            }
        },
        timezone: {
            type: 'string'
        },
        locationTag: {
            type: 'string'
        },
        storage: {
            $ref: '#/def/common/storage'
        },
        memory: {
            type: 'object',
            required: [
                'total',
                'used'
            ],
            properties: {
                total: {
                    type: 'number'
                },
                used: {
                    type: 'number'
                }
            }
        },
        cpus: {
            type: 'object',
            required: [
                'count',
                'usage'
            ],
            properties: {
                count: {
                    type: 'integer'
                },
                usage: {
                    type: 'number'
                }
            }
        },
        clockSkew: {
            type: 'integer'
        },
        dns: {
            type: 'object',
            required: [
                'servers'
            ],
            properties: {
                nameResolution: {
                    type: 'object',
                    required: [
                        'status'
                    ],
                    properties: {
                        status: {
                            $ref: '#/def/common/serviceCheckResult'
                        }
                    }
                },
                servers: {
                    required: [
                        'list'
                    ],
                    list: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                    status: {
                        $ref: '#/def/common/serviceCheckResult'
                    }
                }
            }
        },
        phonehome: {
            type: 'object',
            required: [
                'status',
                'lastStatusCheck'
            ],
            properties: {
                status:{
                    $ref: '#/def/common/serviceCheckResult'
                },
                lastStatusCheck: {
                    type: 'integer'
                }
            }
        },
        clusterConnectivity: {
            type: 'object',
            additionalProperties: {
                $ref: '#/def/common/serviceCheckResult'
            }
        },
        debugMode: {
            type: 'boolean'
        },
        isMaster: {
            type: 'boolean'
        }
    }
};

export default {
    type: 'object',
    required: [
        'servers',
        'serverMinRequirements',
        'supportHighAvailability',
        'isHighlyAvailable',
        'faultTolerance'
    ],
    properties: {
        servers: {
            type: 'object',
            additionalProperties: server
        },
        serverMinRequirements: {
            type: 'object',
            properties: {
                storage: {
                    type: 'integer'
                },
                memory: {
                    type: 'integer'
                },
                cpus: {
                    type: 'integer'
                }
            }
        },
        supportHighAvailability: {
            type: 'boolean'
        },
        isHighlyAvailable: {
            type: 'boolean'
        },
        faultTolerance: {
            type: 'integer',
            minimum: 0
        }
    }
};
