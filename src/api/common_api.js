/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * COMMON API
 *
 * general defenitions used by other api's
 *
 */
module.exports = {

    id: 'common_api',

    definitions: {

        storage_info: {
            type: 'object',
            // required: [],
            properties: {
                // Total Capacity
                total: {
                    $ref: '#/definitions/bigint'
                },
                // "Online/Available" free space
                free: {
                    $ref: '#/definitions/bigint'
                },
                spillover_free: {
                    $ref: '#/definitions/bigint'
                },
                // "Offline/Issues" free space
                unavailable_free: {
                    $ref: '#/definitions/bigint'
                },
                // Used By NooBaa
                used: {
                    $ref: '#/definitions/bigint'
                },
                // Used By NooBaa
                used_other: {
                    $ref: '#/definitions/bigint'
                },
                // Physical NooBaa capacity after compression including dedup, disregarding replicas and policies
                // Example: Sum compressed size of chunks in bucket
                used_reduced: {
                    $ref: '#/definitions/bigint'
                },
                alloc: {
                    $ref: '#/definitions/bigint'
                },
                limit: {
                    $ref: '#/definitions/bigint'
                },
                reserved: {
                    $ref: '#/definitions/bigint'
                },
                // real - after calculating dedup reduction or redundancy overheads
                real: {
                    $ref: '#/definitions/bigint'
                },
            }
        },

        drive_info: {
            type: 'object',
            // required: [],
            properties: {
                mount: {
                    type: 'string'
                },
                drive_id: {
                    type: 'string'
                },
                storage: {
                    $ref: '#/definitions/storage_info'
                },
            }
        },

        os_info: {
            type: 'object',
            // required: [],
            properties: {
                last_update: {
                    format: 'idate'
                },
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
                    type: 'integer'
                },
                freemem: {
                    type: 'integer'
                },
                cpus: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    }
                },
                cpu_usage: {
                    type: 'number'
                },
                networkInterfaces: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                }
            }
        },

        bigint: {
            oneOf: [{
                type: 'integer'
            }, {
                type: 'object',
                properties: {
                    n: {
                        type: 'integer',
                    },
                    // to support bigger integers we can specify a peta field
                    // which is considered to be based from 2^50
                    peta: {
                        type: 'integer',
                    }
                }
            }]
        },

        n2n_config: {
            type: 'object',
            // required: [],
            properties: {
                // ip options
                offer_ipv4: {
                    type: 'boolean'
                },
                offer_ipv6: {
                    type: 'boolean'
                },
                accept_ipv4: {
                    type: 'boolean'
                },
                accept_ipv6: {
                    type: 'boolean'
                },
                offer_internal: {
                    type: 'boolean'
                },

                // tcp options
                tcp_active: {
                    type: 'boolean'
                },
                tcp_permanent_passive: {
                    $ref: '#/definitions/port_range_config'
                },
                tcp_transient_passive: {
                    $ref: '#/definitions/port_range_config'
                },
                tcp_simultaneous_open: {
                    $ref: '#/definitions/port_range_config'
                },
                tcp_tls: {
                    type: 'boolean'
                },

                // udp options
                udp_port: {
                    type: 'boolean'
                },
                udp_dtls: {
                    type: 'boolean'
                },
                stun_servers: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                }
            }
        },

        // false means disable the port.
        // true means random port.
        // object with port means single port.
        // object with min-max means port range.
        port_range_config: {
            oneOf: [{
                type: 'boolean'
            }, {
                type: 'object',
                required: ['port'],
                properties: {
                    port: {
                        type: 'integer'
                    }
                }
            }, {
                type: 'object',
                required: ['min', 'max'],
                properties: {
                    min: {
                        type: 'integer'
                    },
                    max: {
                        type: 'integer'
                    }
                }
            }]
        },

        undeletable_enum: {
            enum: ['SYSTEM_ENTITY', 'NOT_EMPTY', 'IN_USE', 'DEFAULT_RESOURCE'],
            type: 'string',
        },

        block_md: {
            type: 'object',
            required: ['id'],
            properties: {
                id: {
                    type: 'string'
                },
                address: {
                    type: 'string'
                },
                node: {
                    type: 'string'
                },
                delegator: {
                    type: 'string',
                    enum: ['DELEGATOR_AZURE', 'DELEGATOR_S3']
                },
                pool: {
                    type: 'string'
                },
                size: {
                    type: 'integer'
                },
                digest_type: {
                    type: 'string'
                },
                digest_b64: {
                    type: 'string'
                },
            }
        },

        block_action: {
            type: 'string',
            enum: [
                'read',
                'write',
                'replicate',
                'delete'
            ]
        },

        blocks_report: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'block_md',
                    'action',
                    'rpc_code',
                    'error_message'
                ],
                properties: {
                    block_md: {
                        $ref: '#/definitions/block_md'
                    },
                    action: {
                        $ref: '#/definitions/block_action'
                    },
                    rpc_code: {
                        type: 'string'
                    },
                    error_message: {
                        type: 'string'
                    },
                }
            }
        },

        proxy_params: {
            type: 'object',
            required: ['target', 'method_api', 'method_name'],
            properties: {
                target: {
                    type: 'string'
                },
                method_api: {
                    type: 'string'
                },
                method_name: {
                    type: 'string'
                },
                stop_proxy: {
                    type: 'boolean',
                },
                request_params: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                },
                proxy_buffer: {
                    buffer: true
                },
            },
        },

        proxy_reply: {
            type: 'object',
            properties: {
                proxy_reply: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                },
                proxy_buffer: {
                    buffer: true
                },
            }
        },

        access_keys: {
            type: 'object',
            required: ['access_key', 'secret_key'],
            properties: {
                access_key: {
                    type: 'string',
                },
                secret_key: {
                    type: 'string',
                }
            }
        },

        ip_range: {
            type: 'object',
            required: ['start', 'end'],
            properties: {
                start: {
                    type: 'string',
                },
                end: {
                    type: 'string',
                }
            }
        },
        agent_roles_enum: {
            type: 'string',
            enum: ['STORAGE', 'S3']
        }
    }
};
