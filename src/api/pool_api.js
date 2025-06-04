/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * POOLS API
 *
 *
 */
module.exports = {

    $id: 'pool_api',

    methods: {
        create_hosts_pool: {
            doc: 'Create kubernetes base hosts pool',
            method: 'POST',
            params: {
                type: 'object',
                required: [
                    'name',
                    'is_managed',
                    'host_count',
                ],
                properties: {
                    name: {
                        type: 'string'
                    },
                    is_managed: {
                        type: 'boolean'
                    },
                    host_count: {
                        type: 'integer',
                        minimum: 1
                    },
                    host_config: {
                        type: 'object',
                        properties: {
                            volume_size: {
                                $ref: 'common_api#/definitions/bigint'
                            }
                        }
                    },
                    backingstore: {
                        $ref: '#/definitions/backingstore_definition'
                    },
                }
            },
            reply: {
                type: 'string'
            },
            auth: {
                system: 'admin'
            }
        },

        create_cloud_pool: {
            doc: 'Create Cloud Pool',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'connection', 'target_bucket'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    connection: {
                        type: 'string',
                    },
                    target_bucket: {
                        type: 'string',
                    },
                    backingstore: {
                        $ref: '#/definitions/backingstore_definition'
                    },
                    available_capacity: {
                        $ref: 'common_api#/definitions/bigint'
                    },
                    storage_limit: {
                        $ref: 'common_api#/definitions/bigint'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        create_namespace_resource: {
            doc: 'Create Namespace Resource',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    connection: {
                        type: 'string',
                    },
                    target_bucket: {
                        type: 'string',
                    },
                    nsfs_config: {
                        $ref: 'common_api#/definitions/nsfs_config'
                    },
                    access_mode: {
                        type: 'string',
                        enum: ['READ_ONLY', 'READ_WRITE']
                    },
                    namespace_store: {
                        type: 'object',
                        required: ['name', 'namespace'],
                        properties: {
                            name: {
                                type: 'string',
                            },
                            namespace: {
                                type: 'string',
                            },
                        }
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        create_mongo_pool: {
            doc: 'Create Mongo Pool',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        read_pool: {
            doc: 'Read Pool Information',
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            reply: {
                $ref: '#/definitions/pool_extended_info'
            },
            auth: {
                system: 'admin'
            }
        },

        read_namespace_resource: {
            doc: 'Read Namespace Resource',
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            reply: {
                $ref: '#/definitions/namespace_resource_info'
            },
            auth: {
                system: 'admin'
            }
        },

        delete_pool: {
            doc: 'Delete Pool',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        delete_namespace_resource: {
            doc: 'Delete Namespace Resource',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        get_associated_buckets: {
            doc: 'Return list of buckets which are using this pool',
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'string'
                }
            },
            auth: {
                system: 'admin'
            }
        },

        get_cloud_services_stats: {
            doc: 'Return cloud services usage',
            method: 'GET',
            params: {
                type: 'object',
                required: ['start_date', 'end_date'],
                properties: {
                    start_date: { idate: true },
                    end_date: { idate: true },
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        service: {
                            type: 'string',
                            enum: ['AWSSTS', 'AWS', 'AZURE', 'S3_COMPATIBLE', 'GOOGLE', 'FLASHBLADE', 'NET_STORAGE', 'IBM_COS']
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
                    },

                }
            },
            auth: {
                system: 'admin'
            }
        },

        get_pool_history: {
            doc: 'Return usage history for the specified pools',
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    pool_list: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    }
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['timestamp', 'pool_list'],
                    properties: {
                        timestamp: {
                            idate: true
                        },
                        pool_list: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['name', 'storage'],
                                properties: {
                                    name: {
                                        type: 'string'
                                    },
                                    storage: {
                                        $ref: 'common_api#/definitions/storage_info'
                                    },
                                    resource_type: {
                                        $ref: '#/definitions/resource_type'
                                    }
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
        assign_pool_to_region: {
            doc: 'Add a region tag to a resource',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'region'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    region: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_issues_report: {
            doc: 'Add issue to the issues report',
            method: 'POST',
            params: {
                type: 'object',
                required: ['namespace_resource_id', 'time', 'error_code'],
                properties: {
                    time: {
                        idate: true,
                    },
                    error_code: {
                        type: 'string',
                    },
                    namespace_resource_id: {
                        objectid: true
                    },
                    monitoring: {
                        type: 'boolean'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_last_monitoring: {
            doc: 'Update last namespace monitoring',
            method: 'POST',
            params: {
                type: 'object',
                required: ['namespace_resource_id', 'last_monitoring'],
                properties: {
                    last_monitoring: {
                        idate: true,
                    },
                    namespace_resource_id: {
                        objectid: true
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        scale_hosts_pool: {
            doc: 'Change the pool\'s underlaying host count',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'host_count'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    host_count: {
                        type: 'integer'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_cloud_pool: {
            doc: 'Update the cloud pool\'s properties',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    available_capacity: {
                        $ref: 'common_api#/definitions/bigint'
                    },
                    storage_limit: {
                        $ref: 'common_api#/definitions/bigint'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        update_hosts_pool: {
            doc: 'Update the pool\'s underlaying host count from the operator',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },

        get_hosts_pool_agent_config: {
            doc: 'Read the hosts pool\'s agent config',
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            reply: {
                type: 'string'
            },
            auth: {
                system: 'admin'
            }
        },

        get_namespace_resource_operator_info: {
            doc: 'Return namespace resource operator related info',
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                }
            },
            reply: {
                type: 'object',
                properties: {
                    access_key: { $ref: 'common_api#/definitions/access_key' },
                    secret_key: { $ref: 'common_api#/definitions/secret_key' },
                    need_k8s_sync: {
                        type: 'boolean'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        set_namespace_store_info: {
            doc: 'Sets namespace store info to namespace resource',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name', 'namespace'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    namespace: {
                        type: 'string'
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },
    },

    definitions: {
        backingstore_definition: {
            type: 'object',
            required: ['name', 'namespace'],
            properties: {
                name: {
                    type: 'string',
                },
                namespace: {
                    type: 'string',
                }
            }
        },
        pool_definition: {
            type: 'object',
            required: ['name', 'nodes'],
            properties: {
                name: {
                    type: 'string',
                },
                nodes: {
                    type: 'array',
                    items: {
                        $ref: 'node_api#/definitions/node_identity'
                    }
                }
            }
        },

        namespace_resource_info: {
            type: 'object',
            required: ['name'],
            properties: {
                name: {
                    type: 'string'
                },
                endpoint: {
                    type: 'string'
                },
                endpoint_type: {
                    $ref: 'common_api#/definitions/endpoint_type'
                },
                auth_method: {
                    $ref: 'common_api#/definitions/cloud_auth_method'
                },
                target_bucket: {
                    type: 'string'
                },
                cp_code: {
                    type: 'string'
                },
                identity: {
                    $ref: 'common_api#/definitions/access_key'
                },
                fs_root_path: {
                    type: 'string'
                },
                fs_backend: {
                    $ref: 'common_api#/definitions/fs_backend'
                },
                mode: {
                    type: 'string',
                    enum: ['OPTIMAL', 'STORAGE_NOT_EXIST', 'AUTH_FAILED', 'IO_ERRORS']
                },
                undeletable: {
                    $ref: 'common_api#/definitions/undeletable_enum'
                },
                access_mode: {
                    type: 'string',
                    enum: ['READ_ONLY', 'READ_WRITE']
                },
            }
        },

        // Currently the extended info has an addition of secret_key
        namespace_resource_extended_info: {
            type: 'object',
            required: ['name'],
            properties: {
                id: {
                    objectid: true
                },
                name: {
                    type: 'string'
                },
                endpoint: {
                    type: 'string'
                },
                endpoint_type: {
                    $ref: 'common_api#/definitions/endpoint_type'
                },
                auth_method: {
                    $ref: 'common_api#/definitions/cloud_auth_method'
                },
                target_bucket: {
                    type: 'string'
                },
                access_key: { $ref: 'common_api#/definitions/access_key' },
                azure_log_access_keys: { $ref: 'common_api#/definitions/azure_log_access_keys' },
                cp_code: {
                    type: 'string'
                },
                secret_key: { $ref: 'common_api#/definitions/secret_key' },
                fs_root_path: {
                    type: 'string'
                },
                fs_backend: {
                    $ref: 'common_api#/definitions/fs_backend'
                },
                access_mode: {
                    type: 'string',
                    enum: ['READ_ONLY', 'READ_WRITE']
                },
                aws_sts_arn: {
                    type: 'string'
                },
                region: {
                    type: 'string'
                },
                gcp_hmac_key: { $ref: 'common_api#/definitions/gcp_hmac_key' },
            }
        },

        pool_extended_info: {
            type: 'object',
            required: [
                'name',
                'storage',
                'associated_accounts',
                'resource_type',
                'is_managed'
            ],
            properties: {
                name: {
                    type: 'string'
                },
                nodes: {
                    $ref: 'node_api#/definitions/nodes_aggregate_info'
                },
                storage_nodes: {
                    $ref: 'node_api#/definitions/nodes_aggregate_info'
                },
                s3_nodes: {
                    $ref: 'node_api#/definitions/nodes_aggregate_info'
                },
                hosts: {
                    type: 'object',
                    properties: {
                        configured_count: {
                            type: 'integer'
                        },
                        count: {
                            type: 'integer',
                        },
                        by_mode: {
                            type: 'object',
                            additionalProperties: true,
                            properties: {},
                        },
                        by_service: {
                            type: 'object',
                            properties: {
                                STORAGE: {
                                    type: 'integer',
                                },
                                GATEWAY: {
                                    type: 'integer',
                                }
                            }
                        }

                    }

                },
                storage: {
                    $ref: 'common_api#/definitions/storage_info'
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
                            $ref: 'common_api#/definitions/bigint'
                        },
                        write_bytes: {
                            $ref: 'common_api#/definitions/bigint'
                        },
                    }
                },
                undeletable: {
                    $ref: 'common_api#/definitions/undeletable_enum'
                },
                data_activities: {
                    type: 'object',
                    properties: {
                        host_count: {
                            type: 'integer'
                        },
                        activities: {
                            $ref: 'node_api#/definitions/data_activities'
                        }
                    }
                },
                cloud_info: {
                    type: 'object',
                    properties: {
                        endpoint: {
                            type: 'string'
                        },
                        endpoint_type: {
                            $ref: 'common_api#/definitions/endpoint_type'
                        },
                        target_bucket: {
                            type: 'string'
                        },
                        auth_method: {
                            $ref: 'common_api#/definitions/cloud_auth_method'
                        },
                        created_by: {
                            $ref: 'common_api#/definitions/email'
                        },
                        node_name: {
                            type: 'string'
                        },
                        host: {
                            type: 'string'
                        },
                        identity: {
                            $ref: 'common_api#/definitions/access_key'
                        }
                    }
                },
                mongo_info: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {},
                },
                host_info: {
                    type: 'object',
                    properties: {
                        volume_size: {
                            $ref: 'common_api#/definitions/bigint'
                        }
                    }
                },
                pool_node_type: {
                    $ref: 'common_api#/definitions/node_type'
                },
                resource_type: {
                    $ref: '#/definitions/resource_type'
                },
                mode: {
                    $ref: '#/definitions/pool_mode'
                },
                associated_accounts: {
                    type: 'array',
                    items: { $ref: 'common_api#/definitions/email' },
                },
                region: {
                    type: 'string'
                },
                is_managed: {
                    type: 'boolean'
                },
                create_time: {
                    idate: true
                }
            },
        },

        pools_info: {
            type: 'object',
            required: ['pools'],
            properties: {
                pools: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['name', 'nodes_count'],
                        properties: {
                            name: {
                                type: 'string',
                            },
                            nodes_count: {
                                type: 'integer',
                            },
                        }
                    }
                }
            }
        },

        resource_type: {
            type: 'string',
            enum: ['HOSTS', 'CLOUD', 'INTERNAL']
        },

        pool_mode: {
            type: 'string',
            enum: [
                'HAS_NO_NODES',
                'INITIALIZING',
                'INITIALIZING_FAILED',
                'DELETING',
                'ALL_NODES_OFFLINE',
                'SCALING',
                'NO_CAPACITY',
                'ALL_HOSTS_IN_PROCESS',
                'MOST_NODES_ISSUES',
                'MANY_NODES_ISSUES',
                'MOST_STORAGE_ISSUES',
                'MANY_STORAGE_ISSUES',
                'MOST_S3_ISSUES',
                'MANY_S3_ISSUES',
                'MANY_NODES_OFFLINE',
                'LOW_CAPACITY',
                'HIGH_DATA_ACTIVITY',
                'IO_ERRORS',
                'STORAGE_NOT_EXIST',
                'AUTH_FAILED',
                'OPTIMAL'
            ]
        },
    }
};
