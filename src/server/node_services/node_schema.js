/* Copyright (C) 2016 NooBaa */
'use strict';

const storage_stat_schema = {
    type: 'object',
    properties: {
        total: {
            // total amount of storage space on the node/drive
            type: 'number',
        },
        free: {
            // amount of available storage on the node/drive
            type: 'number',
        },
        used: {
            // amount of storage used by the system
            // computed from the data blocks owned by this node
            type: 'number',
        },
        alloc: {
            // preallocated storage space
            type: 'number',
        },
        limit: {
            // top limit for used storage
            type: 'number',
        }
    }
};

module.exports = {
    id: 'node_schema',
    type: 'object',
    required: [
        '_id',
        'name',
    ],
    properties: {
        _id: {
            objectid: true
        },
        name: {
            type: 'string'
        },
        system: {
            objectid: true
        },
        pool: {
            objectid: true
        },
        agent_config: {
            objectid: true
        },
        peer_id: {
            // the identifier used for p2p signaling
            objectid: true
        },

        // a uuid to identify the host machine of the node (one host can hold several nodes, one for each drive)
        host_id: {
            type: 'string'
        },

        // an incremental sequence number
        host_sequence: {
            type: 'integer'
        },

        ports_allowed: {
            type: 'boolean',
        },

        ip: {
            // the public ip of the node
            type: 'string',
        },
        base_address: {
            // the server address that the node is using
            type: 'string',
        },
        rpc_address: {
            // listening rpc address (url) of the agent
            type: 'string',
        },
        heartbeat: {
            // the last time the agent sent heartbeat
            idate: true,
        },
        version: {
            // the last agent version acknoledged
            type: 'string',
        },

        migrating_to_pool: {
            idate: true
        },
        decommissioning: {
            idate: true
        },
        decommissioned: {
            idate: true
        },
        deleting: {
            idate: true
        },
        deleted: {
            idate: true
        },
        force_hide: {
            idate: true
        },

        // node storage stats - sum of drives
        storage: storage_stat_schema,

        drives: {
            type: 'array',
            items: {
                type: 'object',
                required: ['mount', 'drive_id'],
                properties: {
                    mount: {
                        // mount point - linux, drive letter - windows
                        type: 'string',
                    },
                    drive_id: {
                        // a fixed identifier (uuid / device-id / or something like that)
                        type: 'string',
                    },
                    // drive storage stats
                    storage: storage_stat_schema
                }
            }
        },

        // OS information sent by the agent
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

        latency_to_server: {
            type: 'array',
            items: {
                type: 'number'
            }
        },
        latency_of_disk_read: {
            type: 'array',
            items: {
                type: 'number'
            }
        },
        latency_of_disk_write: {
            type: 'array',
            items: {
                type: 'number'
            }
        },

        is_cloud_node: {
            type: 'boolean',
        },

        node_type: {
            type: 'string',
            enum: [
                'BLOCK_STORE_S3',
                'BLOCK_STORE_MONGO',
                'BLOCK_STORE_AZURE',
                'BLOCK_STORE_GOOGLE',
                'BLOCK_STORE_FS',
                'ENDPOINT_S3',
            ]
        },

        is_mongo_node: {
            type: 'boolean',
        },

        is_internal_node: {
            type: 'boolean',
        },

        debug_level: {
            type: 'integer',
        },

        issues_report: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    time: {
                        idate: true
                    },
                    action: {
                        type: 'string'
                    },
                    reason: {
                        type: 'string'
                    },
                    count_since: {
                        idate: true
                    },
                    count: {
                        type: 'integer'
                    },
                }
            }
        },
        srv_error: {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                },
                message: {
                    type: 'string',
                }
            }
        },
        endpoint_stats: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    time: {
                        idate: true
                    },
                    read_count: {
                        type: 'integer'
                    },
                    write_count: {
                        type: 'integer'
                    },
                    read_bytes: {
                        type: 'integer'
                    },
                    write_bytes: {
                        type: 'integer'
                    },
                    last_read: {
                        idate: true
                    },
                    last_write: {
                        idate: true
                    },
                }
            }
        },

    }
};
