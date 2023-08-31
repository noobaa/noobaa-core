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

    $id: 'common_api',

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

        tag: {
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
        },

        tagging: {
            type: 'array',
            items: {
                $ref: '#/definitions/tag'
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

        assume_role_policy: {
            type: 'object',
            required: ['statement'],
            properties: {
                version: { type: 'string' },
                statement: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['effect', 'action', 'principal'],
                        properties: {
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
                                    $ref: '#/definitions/email',
                                }
                            }
                        }
                    }
                },
            }
        },

        // bucket lifecycle

        bucket_lifecycle_rule_expiration: {
            type: 'object',
            properties: {
                days: {
                    minimum: 1,
                    type: 'integer'
                },
                date: {
                    idate: true
                },
                /*
                expired_object_delete_marker: {
                    type: 'boolean'
                }
                */
            }
        },
        bucket_lifecycle_rule_status: {
            enum: ['Enabled', 'Disabled'],
            type: 'string'
        },
        bucket_lifecycle_rule_filter: {
            type: 'object',
            properties: {
                prefix: {
                    type: 'string'
                },
                tags: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/tag',
                    },
                },
                object_size_greater_than: {
                    type: 'number'
                },
                object_size_less_than: {
                    type: 'number'
                },
                // conditional and filter operator, used to reconstruct
                // the original XML S3 REST interface rule representation.
                and: {
                    type: 'boolean'
                }
            }
        },
        bucket_lifecycle_rule: {
            type: 'object',
            required: ['id', 'filter', 'expiration', 'status'],
            properties: {
                id: {
                    type: 'string'
                },
                status: {
                    $ref: '#/definitions/bucket_lifecycle_rule_status'
                },
                filter: {
                    $ref: '#/definitions/bucket_lifecycle_rule_filter'
                },
                expiration: {
                    $ref: '#/definitions/bucket_lifecycle_rule_expiration'
                },
                last_sync: {
                    idate: true
                },
                /*
                abort_incomplete_multipart_upload: {
                    type: 'object',
                    properties: {
                        days_after_initiation: {
                            type: 'integer'
                        },
                    }
                },
                transition: {
                    type: 'object',
                    properties: {
                        date: {
                            idate: true
                        },
                        storage_class: {
                            $ref: '#/definitions/storage_class_enum'
                        }
                    }
                },
                noncurrent_version_expiration: {
                    type: 'object',
                    properties: {
                        noncurrent_days: {
                            type: 'integer'
                        },
                    }
                },
                noncurrent_version_transition: {
                    type: 'object',
                    properties: {
                        noncurrent_days: {
                            type: 'integer'
                        },
                        storage_class: {
                            $ref: '#/definitions/storage_class_enum'
                        }
                    }
                },
                */
            }
        },

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
            enum: ['AWSSTS', 'AWS', 'AZURE', 'S3_COMPATIBLE', 'GOOGLE', 'FLASHBLADE', 'NET_STORAGE', 'IBM_COS']
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
                mapping_info: {
                    type: 'object',
                    properties: {
                        obj_id: { type: 'string' },
                        multipart_id: { type: 'string' },
                        part_id: { type: 'string' },
                        chunk_id: { type: 'string' },
                        frag_id: { type: 'string' },
                        bucket: { type: 'string' },
                        key: { type: 'string' },
                        part_start: { type: 'integer' },
                        part_end: { type: 'integer' },
                        part_seq: { type: 'integer' },
                        data_index: { type: 'integer' },
                        parity_index: { type: 'integer' },
                        lrc_index: { type: 'integer' },
                    }
                },
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

        secret_enc_key: { wrapper: SensitiveString },

        azure_tenant_id: { wrapper: SensitiveString },
        azure_client_id: { wrapper: SensitiveString },
        azure_client_secret: { wrapper: SensitiveString },
        azure_logs_analytics_workspace_id: { wrapper: SensitiveString },

        azure_log_access_keys: {
            type: 'object',
            required: ['azure_tenant_id', 'azure_client_id', 'azure_client_secret', 'azure_logs_analytics_workspace_id'],
            properties: {
                azure_tenant_id: { $ref: '#/definitions/azure_tenant_id' },
                azure_client_id: { $ref: '#/definitions/azure_client_id' },
                azure_client_secret: { $ref: '#/definitions/azure_client_secret' },
                azure_logs_analytics_workspace_id: { $ref: '#/definitions/azure_logs_analytics_workspace_id' },
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
            enum: ['sha1', 'sha256', 'sha384', 'sha512', 'none']
        },

        compress_type: {
            type: 'string',
            enum: ['snappy', 'zlib', 'none']
        },

        cipher_type: {
            type: 'string',
            enum: ['aes-256-gcm', 'none']
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

        op_stats: {
            type: 'object',
            properties: {
                create_bucket: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                list_buckets: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                delete_bucket: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                upload_object: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                delete_object: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                list_objects: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                head_object: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                read_object: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                initiate_multipart: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                upload_part: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                complete_object_upload: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
            }
        },

        fs_workers_stats: {
            type: 'object',
            properties: {
                stat: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                lstat: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                statfs: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                checkaccess: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                unlink: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                unlinkat: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                link: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                linkat: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                mkdir: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                rmdir: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                rename: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                writefile: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                readfile: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                readdir: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                fsync: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                fileopen: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                fileclose: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                fileread: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                filewrite: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                filewritev: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                filereplacexattr: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                finkfileat: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                filegetxattr: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                filestat: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                filefsync: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                realpath: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                getsinglexattr: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                diropen: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                dirclose: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                dirreadentry: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                safelink: {
                    $ref: 'common_api#/definitions/op_stats_val'
                },
                safeunlink: {
                    $ref: 'common_api#/definitions/op_stats_val'
                }
            }
        },

        op_stats_val: {
            type: 'object',
            properties: {
                min_time: {
                    type: 'integer'
                },
                max_time: {
                    type: 'integer'
                },
                sum_time: {
                    type: 'integer'
                },
                count: {
                    type: 'integer'
                },
                error_count: {
                    type: 'integer'
                },
            },
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

        entity: {
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
            required: [],
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

        // nsfs 

        fs_backend: {
            type: 'string',
            enum: ['CEPH_FS', 'GPFS', 'NFSv4']
        },

        nsfs_config: {
            type: 'object',
            required: ['fs_root_path'],
            properties: {
                fs_root_path: {
                    type: 'string'
                },
                fs_backend: {
                    $ref: '#/definitions/fs_backend'
                }
            }
        },
        nsfs_account_config: {
            type: 'object',
            required: ['uid', 'gid', 'new_buckets_path', 'nsfs_only'],
            properties: {
                uid: { type: 'number' },
                gid: { type: 'number' },
                new_buckets_path: { type: 'string' },
                nsfs_only: { type: 'boolean' }
            }
        },
        quota_config: {
            type: 'object',
            properties: {
                size: {
                    type: 'object',
                    required: ['value', 'unit'],
                    properties: {
                        value: {
                            type: 'number',
                            "minimum": 1
                        },
                        unit: {
                            type: 'string',
                            enum: ['G', 'T', 'P']
                        },
                    },
                },
                quantity: {
                    type: 'object',
                    required: ['value'],
                    properties: {
                        value: {
                            type: 'integer',
                            "minimum": 1
                        }
                    },
                }
            }
        },
        role_config: {
            type: 'object',
            required: ['role_name', 'assume_role_policy'],
            properties: {
                role_name: {
                    type: 'string'
                },
                assume_role_policy: {
                    $ref: '#/definitions/assume_role_policy'
                }
            },
        },

        storage_class_enum: {
            type: 'string',
            enum: ['STANDARD', 'GLACIER', 'GLACIER_IR']
        },
    }
};
