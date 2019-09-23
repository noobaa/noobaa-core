/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    required: [
        'name',
        'version',
        'nodeVersion',
        'ipAddress',
        'maintenanceMode',
        'p2pSettings',
        'phoneHome',
        'debug',
        'diagnostics',
        'internalStorage',
        's3Endpoints'
    ],
    properties: {
        name: {
            type: 'string'
        },
        version: {
            type: 'string'
        },
        nodeVersion: {
            type: 'string'
        },
        ipAddress: {
            type: 'string'
        },
        dnsName: {
            type: 'string'
        },
        sslPort: {
            type: 'integer'
        },
        sslCert: {
            type: 'object',
            required: [
                'installed'
            ],
            properties: {
                installed: {
                    type: 'boolean'
                },
                uploadProgress: {
                    type: 'number'
                }
            }
        },
        upgrade: {
            type: 'object',
            properties: {
                lastUpgrade: {
                    type: 'object',
                    required: [
                        'time',
                        'initiator'
                    ],
                    properties: {
                        time: {
                            type: 'integer'
                        },
                        initiator: {
                            type: 'string'
                        }
                    }
                }
            }
        },
        releaseNotes: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                required: [
                    'fetching'
                ],
                properties: {
                    fetching: {
                        type: 'boolean'
                    },
                    error: {
                        type: 'boolean'
                    },
                    text: {
                        type: 'string'
                    }
                }
            }
        },
        p2pSettings: {
            type: 'object',
            required: [
                'tcpPortRange'
            ],
            properties: {
                tcpPortRange: {
                    type: 'object',
                    required: [
                        'start',
                        'end'
                    ],
                    properties: {
                        start: {
                            $ref: '#/def/common/port'
                        },
                        end: {
                            $ref: '#/def/common/port'
                        }
                    }
                }
            }
        },
        phoneHome: {
            type: 'object',
            required: [
                'reachable'
            ],
            properties: {
                reachable: {
                    type: 'boolean'
                }
            }
        },
        debug: {
            type: 'object',
            required: [
                'level',
                'till'
            ],
            properties: {
                level: {
                    type: 'integer',
                    minimum: 0,
                    maximum: 5
                },
                till: {
                    type: 'integer'
                }
            }
        },
        maintenanceMode: {
            type: 'object',
            required: [
                'till'
            ],
            properties: {
                till: {
                    type: 'integer'
                }
            }
        },
        diagnostics: {
            $ref: '#/def/common/diagnostics'
        },
        internalStorage: {
            total: {
                $ref: '#/def/common/size'
            },
            size: {
                $ref: '#/def/common/size'
            }
        },
        s3Endpoints: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'kind',
                    'address'
                ],
                properties: {
                    kind: {
                        type: 'string',
                        enum: [
                            'EXTERNAL',
                            'INTERNAL',
                            'LOOPBACK'
                        ]
                    },
                    address: {
                        type: 'string'
                    }
                }
            }
        }
    }
};
