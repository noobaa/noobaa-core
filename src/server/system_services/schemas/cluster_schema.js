'use strict';

module.exports = {
    id: 'cluster_schema',
    type: 'object',
    required: [
        'owner_secret',
        'cluster_id',
    ],
    properties: {
        _id: {
            format: 'objectid'
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
        owner_shardname: {
            type: 'string',
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

        heartbeat: {
            type: 'object',
            required: ['version', 'time'],
            properties: {
                version: {
                    type: 'string'
                },
                time: {
                    format: 'idate'
                },
                health: {
                    type: 'object',
                    properties: {
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
                                    format: 'idate'
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
                        mongo_rs_status: {
                            type: 'object',
                            properties: {
                                set: {
                                    type: 'string'
                                },
                                members: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            name: {
                                                type: 'string'
                                            },
                                            health: {
                                                type: 'integer'
                                            },
                                            uptime: {
                                                type: 'integer'
                                            },
                                            stateStr: {
                                                type: 'string'
                                            },
                                            syncingTo: {
                                                type: 'string'
                                            },

                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
};
