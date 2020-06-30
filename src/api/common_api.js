/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require('../util/sensitive_string');

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

        bucket_trigger_event: { // Based on AWS: https://docs.aws.amazon.com/AmazonS3/latest/dev/NotificationHowTo.html#supported-notification-event-types
            enum: ['ObjectCreated', 'ObjectRemoved', 'ObjectRead', /* 'ObjectCreated:Put', 'ObjectCreated:CompleteMultipartUpload', ... */ ],
            type: 'string',
        },

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
                // spillover_free: {
                //     $ref: '#/definitions/bigint'
                // },
                // "Offline/Issues" free space
                unavailable_free: {
                    $ref: '#/definitions/bigint'
                },
                // "Offline/Issues" used space
                unavailable_used: {
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

        tagging: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'key',
                    'value'
                ],
                properties: {
                    key: {
                        type: 'string'
                    },
                    value: {
                        type: 'string'
                    },
                }
            }
        },

        bucket_encryption: {
            type: 'object',
            properties: {
                algorithm: {
                    type: 'string',
                    enum: ['AES256', 'aws:kms']
                },
                kms_key_id: {
                    type: 'string'
                }
            }
        },

        // TODO: Update to the relevant schema
        bucket_policy: {
            type: 'object',
            required: ['statement'],
            properties: {
                version: { type: 'string' },
                statement: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['effect', 'action', 'principal', 'resource'],
                        properties: {
                            sid: {
                                type: 'string'
                            },
                            effect: {
                                enum: ['allow', 'deny'],
                                type: 'string'
                            },
                            action: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                }
                            },
                            principal: {
                                type: 'array',
                                items: {
                                    wrapper: SensitiveString,
                                }
                            },
                            resource: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                }
                            }
                        }
                    }
                },
            }
        },

        object_encryption: {
            type: 'object',
            properties: {
                algorithm: {
                    type: 'string',
                    enum: ['AES256', 'aws:kms']
                },
                kms_key_id: {
                    type: 'string'
                },
                context_b64: {
                    type: 'string'
                },
                key_md5_b64: {
                    type: 'string'
                },
                key_b64: {
                    type: 'string'
                }
            }
        },


        bucket_website: {
            type: 'object',
            required: ['website_configuration'],
            properties: {
                website_configuration: {
                    anyOf: [{
                        type: 'object',
                        required: ['redirect_all_requests_to'],
                        properties: {
                            redirect_all_requests_to: {
                                type: 'object',
                                required: ['host_name'],
                                properties: {
                                    host_name: {
                                        type: 'string'
                                    },
                                    protocol: {
                                        type: 'string',
                                        enum: ['HTTP', 'HTTPS']
                                    }
                                }
                            }
                        }
                    }, {
                        type: 'object',
                        required: ['index_document'],
                        properties: {
                            index_document: {
                                type: 'object',
                                required: ['suffix'],
                                properties: {
                                    suffix: {
                                        type: 'string'
                                    },
                                }
                            },
                            error_document: {
                                type: 'object',
                                required: ['key'],
                                properties: {
                                    key: {
                                        type: 'string'
                                    },
                                }
                            },
                            // Must be atleast one routing rule
                            routing_rules: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    required: ['redirect'],
                                    properties: {
                                        condition: {
                                            type: 'object',
                                            // required: ['key_prefix_equals', 'http_error_code_returned_equals'],
                                            properties: {
                                                key_prefix_equals: {
                                                    type: 'string'
                                                },
                                                http_error_code_returned_equals: {
                                                    type: 'string'
                                                },
                                            }
                                        },
                                        redirect: {
                                            type: 'object',
                                            // required: ['protocol', 'host_name'],
                                            properties: {
                                                protocol: {
                                                    type: 'string'
                                                },
                                                host_name: {
                                                    type: 'string'
                                                },
                                                replace_key_prefix_with: {
                                                    type: 'string'
                                                },
                                                replace_key_with: {
                                                    type: 'string'
                                                },
                                                http_redirect_code: {
                                                    type: 'string'
                                                },
                                            }
                                        },
                                    }
                                }
                            },
                        }
                    }]
                },
            },
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
                    idate: true
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
                    idate: true
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
                },
                public_ips: {
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
            enum: [
                'SYSTEM_ENTITY',
                'NOT_EMPTY',
                'IN_USE',
                'CONNECTED_BUCKET_DELETING',
                'DEFAULT_RESOURCE',
                'BEING_DELETED',
                'IS_BACKINGSTORE'
            ],
            type: 'string',
        },

        endpoint_type: {
            type: 'string',
            enum: ['AWS', 'AZURE', 'S3_COMPATIBLE', 'GOOGLE', 'FLASHBLADE', 'NET_STORAGE', 'IBM_COS']
        },

        block_md: {
            type: 'object',
            required: ['id'],
            properties: {
                id: { objectid: true },
                address: { type: 'string' },
                node: { objectid: true },
                pool: { objectid: true },
                size: { type: 'integer' },
                digest_type: { $ref: '#/definitions/digest_type' },
                digest_b64: { type: 'string' },
                node_type: { $ref: '#/definitions/node_type' },
                is_preallocated: { type: 'boolean' },
            }
        },

        node_type: {
            type: 'string',
            enum: [
                'BLOCK_STORE_S3',
                'BLOCK_STORE_MONGO',
                'BLOCK_STORE_AZURE',
                'BLOCK_STORE_GOOGLE',
                'BLOCK_STORE_FS'
            ]
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

        cloud_auth_method: {
            type: 'string',
            enum: ['AWS_V2', 'AWS_V4']
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
            }
        },

        access_key: { wrapper: SensitiveString },

        secret_key: { wrapper: SensitiveString },

        access_keys: {
            type: 'object',
            required: ['access_key', 'secret_key'],
            properties: {
                access_key: { $ref: '#/definitions/access_key' },
                secret_key: { $ref: '#/definitions/secret_key' },
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
        },

        digest_type: {
            type: 'string',
            enum: ['sha1', 'sha256', 'sha384', 'sha512']
        },

        compress_type: {
            type: 'string',
            enum: ['snappy', 'zlib']
        },

        cipher_type: {
            type: 'string',
            enum: ['aes-256-gcm']
        },

        parity_type: {
            type: 'string',
            enum: ['isa-c1', 'isa-rs', 'cm256']
        },

        chunk_split_config: {
            type: 'object',
            properties: {
                avg_chunk: { type: 'integer' },
                delta_chunk: { type: 'integer' },
            }
        },

        chunk_coder_config: {
            type: 'object',
            properties: {
                digest_type: { $ref: '#/definitions/digest_type' },
                frag_digest_type: { $ref: '#/definitions/digest_type' },
                compress_type: { $ref: '#/definitions/compress_type' },
                cipher_type: { $ref: '#/definitions/cipher_type' },
                // Data Copies:
                replicas: { type: 'integer' },
                // Erasure Coding:
                data_frags: { type: 'integer' },
                parity_frags: { type: 'integer' },
                parity_type: { $ref: '#/definitions/parity_type' },
                // LRC:
                lrc_group: { type: 'integer' },
                lrc_frags: { type: 'integer' },
                lrc_type: { $ref: '#/definitions/parity_type' },
            }
        },

        location_info: {
            type: 'object',
            properties: {
                node_id: {
                    objectid: true
                },
                host_id: {
                    type: 'string'
                },
                pool_id: {
                    objectid: true
                },
                region: {
                    type: 'string'
                },
            }
        },

        io_stats: {
            type: 'object',
            properties: {
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
                error_read_count: {
                    type: 'integer'
                },
                error_write_count: {
                    type: 'integer'
                },
                error_read_bytes: {
                    type: 'integer'
                },
                error_write_bytes: {
                    type: 'integer'
                },
            }
        },

        bucket_name: {
            wrapper: SensitiveString,
        },

        tiering_name: {
            wrapper: SensitiveString,
        },

        tier_name: {
            wrapper: SensitiveString,
        },

        email: {
            wrapper: SensitiveString,
        },

        account_name: {
            wrapper: SensitiveString,
        },

        password: {
            wrapper: SensitiveString,
        },

        port: {
            type: 'integer',
            minimum: 0,
            maximum: 65535
        },

        hostname_list: {
            type: 'array',
            items: { type: 'string' }
        },
        bucket_mode: {
            type: 'string',
            enum: [
                'OPTIMAL',
                'DATA_ACTIVITY',
                'APPROUCHING_QUOTA',
                'NO_RESOURCES_INTERNAL',
                'TIER_LOW_CAPACITY',
                'LOW_CAPACITY',
                'TIER_NO_CAPACITY',
                'TIER_NOT_ENOUGH_HEALTHY_RESOURCES',
                'TIER_NOT_ENOUGH_RESOURCES',
                'TIER_NO_RESOURCES',
                'EXCEEDING_QUOTA',
                'ALL_TIERS_HAVE_ISSUES',
                'NO_CAPACITY',
                'NOT_ENOUGH_HEALTHY_RESOURCES',
                'NOT_ENOUGH_RESOURCES',
                'NO_RESOURCES'
            ]
        },

        bucket_cache_ttl: {
            type: 'integer',
            // In milliseconds
            // -1 means infinite ttl
            // 0 means always re-validate
            minimum: -1,
        },

        bucket_cache_config: {
            type: 'object',
            required: [ ],
            properties: {
                ttl_ms: {
                    $ref: '#/definitions/bucket_cache_ttl'
                }
            }
        },

        lock_settings: {
            type: 'object',
            properties: {
                retention: {
                    type: 'object',
                    properties: {
                        mode: { type: 'string' },
                        retain_until_date: { date: true },
                    }
                },
                legal_hold: {
                    type: 'object',
                    properties: {
                        status: { type: 'string' },
                    },
                }
            }
        },
    }
};
