/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'cluster_schema',
    type: 'object',
    required: [
        'owner_secret',
        'cluster_id',
    ],
    properties: {
        _id: {
            objectid: true
        },
        is_clusterized: {
            type: 'boolean'
        },
        owner_secret: {
            type: 'string'
        },
        cluster_id: {
            type: 'string'
        },
        owner_address: {
            type: 'string',
        },
        owner_public_address: {
            type: 'string',
        },
        owner_shardname: {
            type: 'string',
        },
        location: {
            type: 'string'
        },
        shards: {
            type: 'array',
            items: {
                type: 'object',
                required: ['shardname'],
                properties: {
                    shardname: {
                        type: 'string',
                    },
                    servers: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['address'],
                            properties: {
                                address: {
                                    type: 'string',
                                },
                            },
                        },
                    },
                },
            },
        },

        config_servers: {
            type: 'array',
            items: {
                type: 'object',
                required: ['address'],
                properties: {
                    address: {
                        type: 'string',
                    },
                },
            },
        },

        //timezone configuration
        timezone: {
            type: 'string'
        },

        dns_servers: {
            type: 'array',
            items: {
                type: 'string'
            },
        },

        debug_level: {
            type: 'integer'
        },

        debug_mode: {
            idate: true
        },

        heartbeat: {
            type: 'object',
            required: ['version', 'time'],
            properties: {
                version: {
                    type: 'string'
                },
                time: {
                    idate: true
                },
                health: {
                    type: 'object',
                    properties: {
                        usage: {
                            type: 'number'
                        },
                        os_info: {
                            type: 'object',
                            properties: {
                                hostname: {
                                    type: 'string'
                                },
                                ostype: {
                                    type: 'string'
                                },
                                platform: {
                                    type: 'string'
                                },
                                arch: {
                                    type: 'string'
                                },
                                release: {
                                    type: 'string'
                                },
                                uptime: {
                                    idate: true
                                },
                                loadavg: {
                                    type: 'array',
                                    items: {
                                        type: 'number'
                                    }
                                },
                                totalmem: {
                                    type: 'number'
                                },
                                freemem: {
                                    type: 'number'
                                },
                                cpus: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {},
                                        additionalProperties: true
                                    }
                                },
                                networkInterfaces: {
                                    type: 'object',
                                    properties: {},
                                    additionalProperties: true
                                }
                            }
                        },
                        storage: {
                            $ref: 'common_api#/definitions/storage_info'
                        }
                    }
                },
            }
        },
        services_status: {
            type: 'object',
            required: ['ph_status'],
            properties: {
                dns_status: {
                    type: 'string',
                    enum: ['UNKNOWN', 'FAULTY', 'UNREACHABLE', 'OPERATIONAL']
                },
                ph_status: {
                    type: 'object',
                    properties: {
                        status: {
                            type: 'string',
                            enum: ['UNKNOWN', 'FAULTY', 'UNREACHABLE', 'OPERATIONAL']
                        },
                        test_time: {
                            idate: true
                        }
                    }
                },
                dns_name: {
                    type: 'string',
                    enum: ['UNKNOWN', 'FAULTY', 'UNREACHABLE', 'OPERATIONAL']
                },
                internet_connectivity: {
                    type: 'string',
                    enum: ['FAULTY']
                },
                cluster_status: {
                    anyOf: [{
                        type: 'string',
                        enum: ['UNKNOWN']
                    }, {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['secret', 'status'],
                            properties: {
                                secret: {
                                    type: 'string'
                                },
                                status: {
                                    type: 'string',
                                    enum: ['UNKNOWN', 'FAULTY', 'UNREACHABLE', 'OPERATIONAL']
                                }
                            }
                        }
                    }]
                }
            }
        },
        endpoint_groups: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'name',
                    'endpoint_range'
                ],
                properties: {
                    name: {
                        type: 'string'
                    },
                    is_remote: {
                        type: 'boolean'
                    },
                    region: {
                        type: 'string'
                    },
                    endpoint_range: {
                        type: 'object',
                        required: ['min', 'max'],
                        properties: {
                            min: {
                                type: 'integer',
                                minimum: 1
                            },
                            max: {
                                type: 'integer',
                                minimum: 1
                            }
                        }
                    }
                }
            }
        }
    }
};
