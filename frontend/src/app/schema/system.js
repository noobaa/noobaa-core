/* Copyright (C) 2016 NooBaa */

export default {
    type: 'object',
    required: [
        'version',
        'nodeVersion',
        'ipAddress',
        'maintenanceMode',
        'vmTools',
        'p2pSettings',
        'phoneHome',
        'debug',
        'diagnostics',
        'internalStorage'
    ],
    properties: {
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
            type: 'object'
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
                },
                preconditionFailure:  {
                    type: 'string',
                    enum: [
                        'NOT_ALL_MEMBERS_UP',
                        'NOT_ENOUGH_SPACE',
                        'VERSION_MISMATCH'
                    ]
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
        remoteSyslog: {
            type: 'object',
            required: [
                'protocol',
                'address',
                'port'
            ],
            properties: {
                protocol: {
                    type: 'string'
                },
                address: {
                    type: 'string'
                },
                port: {
                    $ref: '#/def/common/port'
                }
            }
        },
        vmTools: {
            type: 'string',
            enum: [
                'NOT_INSTALLED',
                'INSTALLING',
                'INSTALLED'
            ]
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
        proxyServer: {
            type: 'object',
            required: [
                'endpoint',
                'port'
            ],
            properties: {
                endpoint: {
                    type: 'string'
                },
                port: {
                    $ref: '#/def/common/port'
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
        }
    }
};
