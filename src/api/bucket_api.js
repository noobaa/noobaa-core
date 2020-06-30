/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * BUCKET API
 *
 * client (currently web client) talking to the web server to work on bucket
 *
 */
module.exports = {

    id: 'bucket_api',

    methods: {

        put_object_lock_configuration: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name', 'object_lock_configuration'],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    object_lock_configuration: { $ref: '#/definitions/object_lock_configuration' },
                },
            },
            auth: {
                system: 'admin'
            },
        },
        get_object_lock_configuration: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                },
            },
            reply: {
                $ref: '#/definitions/object_lock_configuration'
            },
            auth: {
                system: 'admin'
            },
        },
        create_bucket: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    // if tiering is provided then chunk_coder_config & chunk_split_config are ignored!
                    tiering: { $ref: 'common_api#/definitions/tiering_name' },
                    chunk_split_config: { $ref: 'common_api#/definitions/chunk_split_config' },
                    chunk_coder_config: { $ref: 'common_api#/definitions/chunk_coder_config' },
                    tag: { type: 'string' },
                    object_lock_configuration: { $ref: '#/definitions/object_lock_configuration' },
                    namespace: {
                        type: 'object',
                        required: ['write_resource', 'read_resources'],
                        properties: {
                            write_resource: {
                                type: 'string'
                            },
                            read_resources: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                },
                            },
                            caching: {
                                $ref: 'common_api#/definitions/bucket_cache_config'
                            }
                        }
                    },
                    lock_enabled: {
                        type: 'boolean'
                    },
                    bucket_claim: { $ref: '#/definitions/bucket_claim' },
                }
            },
            reply: {
                $ref: '#/definitions/bucket_info'
            },
            auth: {
                system: 'admin'
            }
        },

        read_bucket: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            reply: {
                $ref: '#/definitions/bucket_info'
            },
            auth: {
                system: 'admin'
            }
        },

        put_bucket_tagging: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'tagging',
                    'name',
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    tagging: {
                        $ref: 'common_api#/definitions/tagging'
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        delete_bucket_tagging: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: [
                    'name'
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        get_bucket_tagging: {
            method: 'GET',
            params: {
                type: 'object',
                required: [
                    'name'
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    tagging: {
                        $ref: 'common_api#/definitions/tagging'
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        put_bucket_encryption: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'encryption',
                    'name',
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    encryption: {
                        $ref: 'common_api#/definitions/bucket_encryption'
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        delete_bucket_encryption: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: [
                    'name'
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        delete_bucket_website: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: [
                    'name'
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        get_bucket_encryption: {
            method: 'GET',
            params: {
                type: 'object',
                required: [
                    'name'
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    encryption: {
                        $ref: 'common_api#/definitions/bucket_encryption'
                    },
                },
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        get_bucket_website: {
            method: 'GET',
            params: {
                type: 'object',
                required: [
                    'name'
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    website: {
                        $ref: 'common_api#/definitions/bucket_website'
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        put_bucket_website: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'website',
                    'name',
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    website: {
                        $ref: 'common_api#/definitions/bucket_website'
                    }
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        get_bucket_policy: {
            method: 'GET',
            params: {
                type: 'object',
                required: [
                    'name'
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    policy: {
                        $ref: 'common_api#/definitions/bucket_policy'
                    },
                },
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        delete_bucket_policy: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: [
                    'name'
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            auth: {
                system: ['admin', 'user']
            }
        },

        put_bucket_policy: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'policy',
                    'name',
                ],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    policy: {
                        $ref: 'common_api#/definitions/bucket_policy'
                    }
                }
            },
            auth: {
                system: ['admin', 'user'],
            }
        },

        read_bucket_sdk_info: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            reply: {
                $ref: '#/definitions/bucket_sdk_info'
            },
            auth: {
                system: 'admin',
                anonymous: true,
            }
        },

        update_bucket: {
            method: 'PUT',
            params: {
                $ref: '#/definitions/update_bucket_params'
            },
            auth: {
                system: 'admin'
            }
        },

        update_buckets: {
            method: 'PUT',
            params: {
                type: 'array',
                items: {
                    $ref: '#/definitions/update_bucket_params'
                },
            },
            auth: {
                system: 'admin'
            }
        },

        delete_bucket: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    // internal_call is used by bucket_reclaimer to delete the bucket after it's empty
                    internal_call: { type: 'boolean' },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        delete_bucket_and_objects: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            auth: {
                // maybe only allow operator to perform this?
                system: 'admin'
            }
        },

        delete_bucket_lifecycle: {
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        list_buckets: {
            method: 'GET',
            reply: {
                type: 'object',
                required: ['buckets'],
                properties: {
                    buckets: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['name'],
                            properties: {
                                name: { $ref: 'common_api#/definitions/bucket_name' },
                            }
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_bucket_s3_access: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name', 'allowed_accounts'],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    allowed_accounts: {
                        type: 'array',
                        items: { $ref: 'common_api#/definitions/account_name' },
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        export_bucket_bandwidth_usage: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name', 'since', 'till'],
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    since: {
                        idate: true
                    },
                    till: {
                        idate: true
                    },
                }
            },
            reply: {
                type: 'string',
            },
            auth: {
                system: 'admin'
            }
        },

        get_bucket_throughput_usage: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['since', 'till', 'resolution', 'buckets'],
                properties: {
                    buckets: {
                        type: 'array',
                        items: { $ref: 'common_api#/definitions/bucket_name' },
                    },
                    since: { idate: true },
                    till: { idate: true },
                    resolution: {
                        type: 'integer'
                    }
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['start_time', 'end_time', 'read_count', 'read_bytes', 'write_count', 'write_bytes'],
                    properties: {
                        start_time: {
                            idate: true
                        },
                        end_time: {
                            idate: true
                        },
                        read_count: {
                            type: 'integer'
                        },
                        write_count: {
                            type: 'integer'
                        },
                        read_bytes: {
                            $ref: 'common_api#/definitions/bigint'
                        },
                        write_bytes: {
                            $ref: 'common_api#/definitions/bigint'
                        },
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        get_buckets_stats_by_content_type: {
            method: 'GET',
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        name: { $ref: 'common_api#/definitions/bucket_name' },
                        stats: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    content_type: {
                                        type: 'string'
                                    },
                                    reads: {
                                        type: 'integer',
                                    },
                                    writes: {
                                        type: 'integer',
                                    },
                                    last_read: {
                                        idate: true
                                    },
                                    last_write: {
                                        idate: true
                                    },
                                }
                            }
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        get_objects_size_histogram: {
            method: 'GET',
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        name: { $ref: 'common_api#/definitions/bucket_name' },
                        bins: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    count: {
                                        type: 'integer'
                                    },
                                    sum: {
                                        type: 'integer'
                                    },
                                }
                            }
                        }
                    }
                }
            },
            auth: {
                system: ['admin']
            }
        },

        get_cloud_buckets: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['connection'],
                properties: {
                    connection: {
                        type: 'string'
                    }
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                        name: { $ref: 'common_api#/definitions/bucket_name' },
                        used_by: {
                            type: 'object',
                            required: ['name', 'usage_type'],
                            properties: {
                                name: { $ref: 'common_api#/definitions/bucket_name' },
                                usage_type: {
                                    type: 'string',
                                    enum: ['CLOUD_RESOURCE', 'NAMESPACE_RESOURCE']
                                },
                            }
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        set_bucket_lifecycle_configuration_rules: {
            method: 'PUT',
            params: {
                type: 'object',
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    rules: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['id', 'prefix', 'status', 'expiration'],
                            properties: {
                                id: {
                                    type: 'string'
                                },
                                prefix: {
                                    type: 'string'
                                },
                                status: {
                                    type: 'string'
                                },
                                expiration: {
                                    type: 'object',
                                    properties: {
                                        days: {
                                            type: 'integer'
                                        },
                                        date: {
                                            idate: true
                                        },
                                        expired_object_delete_marker: {
                                            type: 'boolean'
                                        }

                                    }
                                },
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
                            }
                        },
                    }
                }
            },
            auth: {
                system: 'admin'
            },
        },

        get_bucket_lifecycle_configuration_rules: {
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['id', 'prefix', 'status', 'expiration'],
                    properties: {
                        id: {
                            type: 'string'
                        },
                        prefix: {
                            type: 'string'
                        },
                        status: {
                            type: 'string'
                        },
                        last_sync: {
                            idate: true
                        },
                        expiration: {
                            type: 'object',
                            properties: {
                                days: {
                                    type: 'integer'
                                },
                                date: {
                                    idate: true
                                },
                                expired_object_delete_marker: {
                                    type: 'boolean'
                                }

                            }
                        },
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
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        add_bucket_lambda_trigger: {
            method: 'PUT',
            params: {
                $ref: '#/definitions/new_lambda_trigger'
            },
            auth: {
                system: 'admin'
            }
        },

        delete_bucket_lambda_trigger: {
            method: 'DELETE',
            required: ['id', 'bucket_name'],
            params: {
                type: 'object',
                properties: {
                    id: {
                        objectid: true
                    },
                    bucket_name: { $ref: 'common_api#/definitions/bucket_name' },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_bucket_lambda_trigger: {
            method: 'PUT',
            params: {
                $ref: '#/definitions/update_lambda_trigger'
            },
            auth: {
                system: 'admin'
            }
        },

        update_all_buckets_default_pool: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['pool_name'],
                properties: {
                    pool_name: {
                        type: 'string'
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        claim_bucket: {
            method: 'PUT',
            required: ['name', 'tiering', 'email', 'create_bucket', 'namespace'],
            params: {
                type: 'object',
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    tiering: { $ref: 'common_api#/definitions/tiering_name' },
                    email: { $ref: 'common_api#/definitions/email' },
                    create_bucket: { type: 'boolean' },
                    bucket_claim: { $ref: '#/definitions/bucket_claim' },
                },
            },
            reply: {
                type: 'object',
                required: ['access_keys'],
                properties: {
                    access_keys: {
                        $ref: 'common_api#/definitions/access_keys'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        delete_claim: {
            method: 'PUT',
            required: ['name', 'email', 'delete_bucket'],
            params: {
                type: 'object',
                properties: {
                    name: { $ref: 'common_api#/definitions/bucket_name' },
                    email: { $ref: 'common_api#/definitions/email' },
                    delete_bucket: { type: 'boolean' }
                },
            },
            auth: {
                system: 'admin'
            }
        }
    },

    definitions: {

        bucket_info: {
            type: 'object',
            required: ['name', 'bucket_type', 'tiering', 'versioning', 'usage_by_pool', 'storage', 'data', 'num_objects', 'host_tolerance', 'node_tolerance', 'writable', 'mode'],
            properties: {
                name: { $ref: 'common_api#/definitions/bucket_name' },
                bucket_type: {
                    enum: ['REGULAR', 'NAMESPACE'],
                    type: 'string',
                },
                owner_account: {
                    type: 'object',
                    required: ['email', 'id'],
                    properties: {
                        email: { $ref: 'common_api#/definitions/email' },
                        id: { objectid: true }
                    }
                },
                versioning: { $ref: '#/definitions/versioning' },
                namespace: {
                    $ref: '#/definitions/bucket_namespace'
                },
                bucket_claim: { $ref: '#/definitions/bucket_claim' },
                tiering: {
                    $ref: 'tiering_policy_api#/definitions/tiering_policy'
                },
                spillover: {
                    type: 'string'
                },
                object_lock_configuration: { $ref: '#/definitions/object_lock_configuration' },
                storage: {
                    type: 'object',
                    properties: {
                        values: {
                            $ref: 'common_api#/definitions/storage_info'
                        },
                        last_update: {
                            idate: true
                        }
                    }
                },
                quota: {
                    type: 'object',
                    required: ['size', 'unit'],
                    properties: {
                        size: {
                            type: 'integer'
                        },
                        unit: {
                            type: 'string',
                            enum: ['GIGABYTE', 'TERABYTE', 'PETABYTE']
                        },
                    }
                },
                data: {
                    type: 'object',
                    properties: {
                        // This is the sum of all compressed chunks that are related to the bucket.
                        // Which means that it includes dedup and compression, but not replicas.
                        size_reduced: {
                            $ref: 'common_api#/definitions/bigint'
                        },
                        // This is logical size aggregation of objects that are related to the bucket.
                        size: {
                            $ref: 'common_api#/definitions/bigint'
                        },
                        // This is the actual free space of the bucket considering data placement policy.
                        // On mirror it is the minimum free space of the pools, on spread it is the sum.
                        // Also we divide by replicas in order to get the actual size that can be written.
                        free: {
                            $ref: 'common_api#/definitions/bigint'
                        },
                        available_for_upload: {
                            $ref: 'common_api#/definitions/bigint'
                        },
                        // spillover_free: {
                        //     $ref: 'common_api#/definitions/bigint'
                        // },
                        last_update: {
                            idate: true
                        }
                    }
                },
                usage_by_pool: {
                    type: 'object',
                    required: ['last_update', 'pools'],
                    properties: {
                        last_update: {
                            idate: true
                        },
                        pools: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['pool_name', 'storage'],
                                properties: {
                                    pool_name: {
                                        type: 'string'
                                    },
                                    storage: {
                                        type: 'object',
                                        required: ['blocks_size'],
                                        properties: {
                                            blocks_size: {
                                                $ref: 'common_api#/definitions/bigint'
                                            },
                                        },
                                    }
                                },
                            },
                        },
                    }
                },
                num_objects: {
                    type: 'object',
                    required: ['value', 'last_update'],
                    properties: {
                        value: {
                            type: 'integer'
                        },
                        last_update: {
                            idate: true
                        }
                    }
                },
                host_tolerance: {
                    type: 'integer'
                },
                node_tolerance: {
                    type: 'integer'
                },
                tag: {
                    type: 'string'
                },
                writable: {
                    type: 'boolean'
                },
                stats: {
                    type: 'object',
                    properties: {
                        reads: {
                            type: 'integer'
                        },
                        writes: {
                            type: 'integer'
                        },
                        last_read: {
                            idate: true
                        },
                        last_write: {
                            idate: true
                        },
                    },
                },
                stats_by_type: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            data_type: {
                                type: 'string'
                            },
                            reads: {
                                type: 'integer'
                            },
                            writes: {
                                type: 'integer'
                            },
                            size: {
                                $ref: 'common_api#/definitions/bigint'
                            },
                            count: {
                                type: 'integer'
                            },
                        },
                    }
                },
                policy_modes: {
                    $ref: '#/definitions/policy_modes'
                },
                mode: {
                    $ref: 'common_api#/definitions/bucket_mode'
                },
                undeletable: {
                    $ref: '#/definitions/undeletable_bucket_reason'
                },
                triggers: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/lambda_trigger_info'
                    }
                },
                tagging: {
                    $ref: 'common_api#/definitions/tagging'
                },
                encryption: {
                    $ref: 'common_api#/definitions/bucket_encryption'
                },
                website: {
                    $ref: 'common_api#/definitions/bucket_website'
                },
                policy: {
                    $ref: 'common_api#/definitions/bucket_policy'
                },
            }
        },

        bucket_namespace: {
            type: 'object',
            required: [
                'read_resources',
                'write_resource',
            ],
            properties: {
                read_resources: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },
                write_resource: {
                    type: 'string'
                },
                caching: {
                    $ref: 'common_api#/definitions/bucket_cache_config'
                }
            }
        },

        bucket_claim: {
            type: 'object',
            required: ['bucket_class', 'namespace'],
            properties: {
                // TODO: Fill this with relevant info
                bucket_class: {
                    type: 'string',
                },
                namespace: {
                    type: 'string',
                }
            }
        },

        bucket_sdk_info: {
            type: 'object',
            required: [
                'name', 'system_owner', 'bucket_owner'
            ],
            properties: {
                name: {
                    $ref: 'common_api#/definitions/bucket_name'
                },
                system_owner: {
                    $ref: 'common_api#/definitions/email'
                },
                bucket_owner: {
                    $ref: 'common_api#/definitions/email'
                },
                website: {
                    $ref: 'common_api#/definitions/bucket_website'
                },
                namespace: {
                    type: 'object',
                    required: [
                        'read_resources',
                        'write_resource',
                    ],
                    properties: {
                        read_resources: {
                            type: 'array',
                            items: {
                                $ref: 'pool_api#/definitions/namespace_resource_extended_info'
                            }
                        },
                        write_resource: {
                            $ref: 'pool_api#/definitions/namespace_resource_extended_info'
                        },
                        caching: {
                            $ref: 'common_api#/definitions/bucket_cache_config'
                        },
                    },
                },
                active_triggers: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            event_name: {
                                $ref: 'common_api#/definitions/bucket_trigger_event'
                            },
                            object_prefix: {
                                type: 'string'
                            },
                            object_suffix: {
                                type: 'string'
                            }
                        }
                    }
                },
                s3_policy: {
                    $ref: 'common_api#/definitions/bucket_policy'
                },
            }
        },

        storage_class_enum: {
            enum: ['STANDARD_IA', 'GLACIER'],
            type: 'string'
        },
        update_bucket_params: {
            type: 'object',
            required: ['name'],
            properties: {
                name: { $ref: 'common_api#/definitions/bucket_name' },
                new_name: { $ref: 'common_api#/definitions/bucket_name' },
                tiering: { $ref: 'common_api#/definitions/tiering_name' },
                new_tag: {
                    type: 'string',
                },
                quota: {
                    anyOf: [{
                        type: 'null'
                    }, {
                        type: 'object',
                        required: ['size', 'unit'],
                        properties: {
                            size: {
                                type: 'integer'
                            },
                            unit: {
                                type: 'string',
                                enum: ['GIGABYTE', 'TERABYTE', 'PETABYTE']
                            },
                        }
                    }]
                },
                // spillover: {
                //     oneOf: [{
                //         type: 'string'
                //     }, {
                //         type: 'null'
                //     }]
                // },
                namespace: {
                    type: 'object',
                    required: ['write_resource', 'read_resources'],
                    properties: {
                        write_resource: {
                            type: 'string'
                        },
                        read_resources: {
                            type: 'array',
                            items: {
                                type: 'string'
                            },
                        }
                    }
                },
                versioning: { $ref: '#/definitions/versioning' },
            }
        },
        policy_modes: {
            type: 'object',
            required: ['resiliency_status', 'quota_status'],
            properties: {
                resiliency_status: {
                    type: 'string',
                    enum: [
                        'NOT_ENOUGH_RESOURCES',
                        'POLICY_PARTIALLY_APPLIED',
                        'RISKY_TOLERANCE',
                        'DATA_ACTIVITY',
                        'OPTIMAL'
                    ]
                },
                quota_status: {
                    type: 'string',
                    enum: [
                        'QUOTA_NOT_SET',
                        'APPROUCHING_QUOTA',
                        'EXCEEDING_QUOTA',
                        'OPTIMAL'
                    ]
                },
            }
        },
        undeletable_bucket_reason: {
            enum: ['NOT_EMPTY'],
            type: 'string',
        },


        new_lambda_trigger: {
            type: 'object',
            required: ['bucket_name', 'event_name', 'func_name'],
            properties: {
                bucket_name: { $ref: 'common_api#/definitions/bucket_name' },
                event_name: {
                    $ref: 'common_api#/definitions/bucket_trigger_event'
                },
                func_name: {
                    type: 'string'
                },
                func_version: {
                    type: 'string'
                },
                enabled: {
                    type: 'boolean',
                },
                object_prefix: {
                    type: 'string'
                },
                object_suffix: {
                    type: 'string'
                },
            }
        },

        update_lambda_trigger: {
            type: 'object',
            required: ['id'],
            properties: {
                id: {
                    objectid: true
                },
                bucket_name: { $ref: 'common_api#/definitions/bucket_name' },
                event_name: {
                    $ref: 'common_api#/definitions/bucket_trigger_event'
                },
                func_name: {
                    type: 'string'
                },
                func_version: {
                    type: 'string'
                },
                enabled: {
                    type: 'boolean',
                },
                object_prefix: {
                    type: 'string'
                },
                object_suffix: {
                    type: 'string'
                },
            }
        },

        versioning: {
            type: 'string',
            enum: ['DISABLED', 'SUSPENDED', 'ENABLED']
        },

        lambda_trigger_info: {
            type: 'object',
            required: ['id', 'event_name', 'func_name'],
            properties: {
                id: {
                    objectid: true
                },
                event_name: {
                    $ref: 'common_api#/definitions/bucket_trigger_event'
                },
                func_name: {
                    type: 'string'
                },
                func_version: {
                    type: 'string'
                },
                enabled: {
                    type: 'boolean',
                },
                permission_problem: {
                    type: 'boolean',
                },
                last_run: {
                    idate: true
                },
                object_prefix: {
                    type: 'string'
                },
                object_suffix: {
                    type: 'string'
                },
            }
        },
        object_lock_configuration: {
            type: 'object',
            properties: {
                object_lock_enabled: { type: 'string' },
                rule: {
                    type: 'object',
                    properties: {
                        default_retention: {
                            oneOf: [{
                                    type: 'object',
                                    properties: {
                                        years: { type: 'integer' },
                                        mode: {
                                            type: 'string',
                                            enum: ['GOVERNANCE', 'COMPLIANCE']
                                        }
                                    }
                                },
                                {
                                    type: 'object',
                                    properties: {
                                        days: { type: 'integer' },
                                        mode: {
                                            type: 'string',
                                            enum: ['GOVERNANCE', 'COMPLIANCE']
                                        }
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        },
    }
};
