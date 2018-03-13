export default {
    type: 'object',
    required: [
        'version'
    ],
    properties: {
        version: {
            type: 'string'
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
        }
    }
};
