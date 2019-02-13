/* Copyright (C) 2016 NooBaa */
'use strict';

const { SensitiveString } = require('../../../util/schema_utils');

module.exports = {
    id: 'cluster_schema',
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

        //NTP configuration
        ntp: {
            type: 'object',
            properties: {
                server: {
                    type: 'string'
                },
                timezone: {
                    type: 'string'
                },
            }
        },

        dns_servers: {
            type: 'array',
            items: {
                type: 'string'
            },
        },

        search_domains: {
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

        vmtools_installed: {
            type: 'boolean'
        },

        //Upgrade proccess
        upgrade: {
            type: 'object',
            properties: {
                path: {
                    type: 'string'
                },
                mongo_upgrade: {
                    type: 'boolean'
                },
                status: {
                    type: 'string',
                    enum: [
                        'PENDING',
                        'FAILED',
                        'CAN_UPGRADE',
                        'UPGRADING',
                        'COMPLETED',
                        'PRE_UPGRADE_PENDING',
                        'PRE_UPGRADE_READY',
                        'UPGRADE_FAILED'
                    ]
                },
                stage: {
                    type: 'string',
                    enum: [
                        'COPY_NEW_CODE',
                        'DB_READY',
                        'UPGRADE_ABORTED',
                        'UPGRADE_PLATFORM',
                        'UPGRADE_MONGODB_VER',
                        'UPGRADE_MONGODB_SCHEMAS',
                        'UPDATE_SERVICES',
                        'CLEANUP',
                        'UPGRADE_COMPLETED',
                    ]
                },
                error: {
                    type: 'string'
                },
                report_info: {
                    type: 'string'
                },
                initiator_email: {
                    wrapper: SensitiveString,
                },
                tested_date: {
                    idate: true
                },
                staged_package: {
                    type: 'string'
                },
                package_uploaded: {
                    idate: true
                }
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
                        },
                        storage: {
                            $ref: 'common_api#/definitions/storage_info'
                        }
                    }
                },
            }
        },
        ip_collision: {
            type: 'array',
            items: {
                type: 'string'
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
                ntp_status: {
                    type: 'string',
                    enum: ['UNKNOWN', 'FAULTY', 'UNREACHABLE', 'OPERATIONAL']
                },
                internet_connectivity: {
                    type: 'string',
                    enum: ['FAULTY']
                },
                proxy_status: {
                    type: 'string',
                    enum: ['UNKNOWN', 'FAULTY', 'UNREACHABLE', 'OPERATIONAL']
                },
                remote_syslog_status: {
                    type: 'string',
                    enum: ['UNKNOWN', 'FAULTY', 'UNREACHABLE', 'OPERATIONAL']
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
        }
    }
};
