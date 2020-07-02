/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * SYSTEM API
 *
 * client (currently web client) talking to the web server to work on system
 * (per client group - contains nodes, tiers abd bckets etc)
 *
 */
module.exports = {

    id: 'system_api',

    methods: {
        get_system_status: {
            doc: 'Query for the status of a system',
            method: 'GET',
            reply: {
                type: 'object',
                required: ['state', 'last_state_change'],
                properties: {
                    state: {
                        type: 'string',
                        enum: [
                            'DOES_NOT_EXIST',
                            'INITIALIZING',
                            'COULD_NOT_INITIALIZE',
                            'READY',
                        ]
                    },
                    last_state_change: { idate: true }
                }
            },
            auth: {
                account: false,
                system: false,
                anonymous: true,
            },
        },

        create_system: {
            doc: 'Create a new system',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                    name: {
                        type: 'string',
                    },
                    email: { $ref: 'common_api#/definitions/email' },
                    password: { $ref: 'common_api#/definitions/password' },
                    //Optionals: DNS, NTP and NooBaa Domain Name
                    dns_servers: {
                        type: 'array',
                        items: {
                            type: 'string'
                        },
                    },
                    dns_name: {
                        type: 'string'
                    },
                    // require password change on first login
                    must_change_password: {
                        type: 'boolean'
                    }
                },
            },
            reply: {
                type: 'object',
                required: ['token'],
                properties: {
                    token: {
                        type: 'string'
                    },
                    operator_token: {
                        type: 'string'
                    }
                }
            },
            auth: {
                account: false,
                system: false,
                anonymous: true,
            }
        },

        read_system: {
            doc: 'Read the info of the authorized system',
            method: 'GET',
            reply: {
                $ref: '#/definitions/system_full_info'
            },
            auth: {
                system: 'admin',
            }
        },

        update_system: {
            doc: 'Update the authorized system',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                },
            },
            auth: {
                system: 'admin',
            }
        },

        set_maintenance_mode: {
            doc: 'Configure system maintenance',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['duration'],
                properties: {
                    // Number of minutes
                    duration: {
                        type: 'number',
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        set_webserver_master_state: {
            doc: 'Set if webserver is master',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['is_master'],
                properties: {
                    is_master: {
                        type: 'boolean',
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        delete_system: {
            doc: 'Delete the authorized system',
            method: 'DELETE',
            auth: {
                system: 'admin',
            }
        },


        list_systems: {
            doc: 'List the systems that the authorized account can access',
            method: 'GET',
            reply: {
                type: 'object',
                required: ['systems'],
                properties: {
                    systems: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/system_info'
                        }
                    }
                }
            },
            auth: {
                system: false,
            }
        },

        log_frontend_stack_trace: {
            doc: 'Add frontend stack trace to logs',
            method: 'POST',
            params: {
                type: 'object',
                required: ['stack_trace'],
                properties: {
                    stack_trace: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {},
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        add_role: {
            doc: 'Add role',
            method: 'POST',
            params: {
                type: 'object',
                required: ['role', 'email'],
                properties: {
                    email: { $ref: 'common_api#/definitions/email' },
                    role: {
                        $ref: '#/definitions/role_enum'
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        remove_role: {
            doc: 'Remove role',
            method: 'DELETE',
            params: {
                type: 'object',
                required: ['role', 'email'],
                properties: {
                    email: { $ref: 'common_api#/definitions/email' },
                    role: {
                        $ref: '#/definitions/role_enum'
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        set_last_stats_report_time: {
            doc: 'Set last stats report sync time',
            method: 'PUT',
            params: {
                type: 'object',
                required: ['last_stats_report'],
                properties: {
                    last_stats_report: {
                        idate: true,
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        update_n2n_config: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['config'],
                properties: {
                    config: {
                        $ref: 'common_api#/definitions/n2n_config'
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        },

        attempt_server_resolve: {
            doc: 'Attempt to resolve a server name + ping',
            method: 'POST',
            params: {
                type: 'object',
                required: ['server_name'],
                properties: {
                    server_name: {
                        type: 'string'
                    },
                    ping: {
                        type: 'boolean'
                    },
                    version_check: {
                        type: 'boolean'
                    }
                },
            },
            reply: {
                type: 'object',
                required: ['valid'],
                properties: {
                    valid: {
                        type: 'boolean'
                    },
                    reason: {
                        type: 'string'
                    }
                }
            },
            auth: {
                account: false,
                system: false,
            }
        },

        log_client_console: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['data'],
                properties: {
                    data: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                },
            },
            auth: {
                system: 'admin',
            }
        },

        get_join_cluster_yaml: {
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    region: { type: 'string' },
                    endpoints: {
                        type: 'object',
                        required: [
                            'min_count'
                        ],
                        properties: {
                            min_count: {
                                type: 'integer',
                                minimum: 1
                            },
                            max_count: {
                                type: 'integer',
                                minimum: 1
                            }
                        }
                    }
                }
            },
            reply: {
                type: 'string'
            },
            auth: {
                system: 'admin',
            }
        },

        update_endpoint_group: {
            method: 'POST',
            params: {
                type: 'object',
                required: [
                    'group_name',
                    'region',
                    'endpoint_range'
                ],
                properties: {
                    group_name: {
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
            },
            auth: {
                system: 'admin'
            }
        },

        get_endpoints_history: {
             method: 'GET',
             params: {
                 type: 'object',
                 required: [
                     'since'
                 ],
                 properties: {
                     since: {
                         idate: true
                     },
                     till: {
                         idate: true
                     },
                     step: {
                         type: 'integer'
                     },
                     groups: {
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
                     properties: {
                        timestamp: {
                            idate: true
                        },
                        endpoint_count: {
                            type: 'number'
                        },
                        cpu_count: {
                            type: 'number'
                        },
                        cpu_usage: {
                            type: 'number'
                        },
                        memory_usage: {
                            type: 'number'
                        },
                        read_bytes: {
                            type: 'number'
                        },
                        write_bytes: {
                            type: 'number'
                        }
                     }
                 }
             },
             auth: {
                 system: 'admin'
             }
        }
    },

    definitions: {

        system_info: {
            type: 'object',
            required: ['name'],
            properties: {
                name: {
                    type: 'string',
                },
            },
        },


        system_full_info: {
            type: 'object',
            required: [
                'name',
                'roles',
                'tiers',
                'pools',
                'storage',
                'nodes',
                'buckets',
                'objects',
                'owner',
                'node_version',
                's3_service',
                'endpoint_groups'
            ],
            properties: {
                name: {
                    type: 'string',
                },
                roles: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/role_info'
                    }
                },
                owner: {
                    $ref: 'account_api#/definitions/account_info'
                },
                last_stats_report: {
                    idate: true,
                },
                tiers: {
                    type: 'array',
                    items: {
                        $ref: 'tier_api#/definitions/tier_info'
                    }
                },
                storage: {
                    $ref: 'common_api#/definitions/storage_info'
                },
                nodes_storage: {
                    $ref: 'common_api#/definitions/storage_info'
                },
                nodes: {
                    $ref: 'node_api#/definitions/nodes_aggregate_info'
                },
                // A workaround to return host counters to be used in overview until
                // rewrite of overview to use proper hosts state.
                hosts: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                },
                buckets: {
                    type: 'array',
                    items: {
                        $ref: 'bucket_api#/definitions/bucket_info'
                    }
                },
                namespace_resources: {
                    type: 'array',
                    items: {
                        $ref: 'pool_api#/definitions/namespace_resource_info'
                    }
                },
                pools: {
                    type: 'array',
                    items: {
                        $ref: 'pool_api#/definitions/pool_extended_info'
                    },
                },
                accounts: {
                    type: 'array',
                    items: {
                        $ref: 'account_api#/definitions/account_info'
                    }
                },
                functions: {
                    type: 'array',
                    items: {
                        $ref: 'func_api#/definitions/func_info'
                    }
                },
                objects: {
                    type: 'integer'
                },
                ssl_port: {
                    type: 'string'
                },
                maintenance_mode: {
                    type: 'object',
                    required: ['state'],
                    properties: {
                        state: {
                            type: 'boolean',
                        },
                        time_left: {
                            type: 'integer',
                        },
                    }
                },
                n2n_config: {
                    $ref: 'common_api#/definitions/n2n_config'
                },
                phone_home_config: {
                    type: 'object',
                    properties: {
                        upgraded_cap_notification: {
                            type: 'boolean'
                        },
                        phone_home_unable_comm: {
                            type: 'boolean'
                        },
                    }
                },
                ip_address: {
                    type: 'string'
                },
                dns_name: {
                    type: 'string'
                },
                base_address: {
                    type: 'string'
                },
                version: {
                    type: 'string'
                },
                node_version: {
                    type: 'string'
                },
                debug: {
                    type: 'object',
                    required: ['level'],
                    properties: {
                        level: {
                            type: 'integer',
                        },
                        time_left: { // in ms
                            type: 'integer'
                        },
                    },
                },
                system_cap: {
                    type: 'integer'
                },
                has_ssl_cert: {
                    type: 'boolean'
                },
                upgrade: {
                    type: 'object',
                    properties: {
                        last_upgrade: {
                            type: 'object',
                            properties: {
                                timestamp: {
                                    idate: true
                                }
                            }
                        }
                    },
                },
                cluster: {
                    $ref: '#/definitions/cluster_info'
                },
                defaults: {
                    type: 'object',
                    properties: {
                        tiers: {
                            type: 'object',
                            properties: {
                                data_frags: { type: 'integer' },
                                parity_frags: { type: 'integer' },
                                replicas: { type: 'integer' },
                                failure_tolerance_threshold: { type: 'integer' }
                            }
                        }
                    }
                },
                platform_restrictions: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/restriction_enum'
                    }
                },
                s3_service: {
                    type: 'object',
                    required: ['addresses'],
                    properties: {
                        addresses: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['kind', 'address'],
                                properties: {
                                    kind: {
                                        type: 'string',
                                        enum: ['EXTERNAL', 'INTERNAL', 'LOOPBACK']
                                    },
                                    address: {
                                        type: 'string'
                                    }
                                }
                            }
                        }
                    }
                },
                endpoint_groups: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: [
                            'group_name',
                            'is_remote',
                            'endpoint_count',
                            'min_endpoint_count',
                            'max_endpoint_count',
                            'cpu_count',
                            'cpu_usage',
                            'memory_usage',
                            'last_report_time'
                        ],
                        properties: {
                            group_name: { type: 'string' },
                            is_remote: { type: 'boolean' },
                            region: { type: 'string' },
                            endpoint_count: { type: 'number' },
                            min_endpoint_count: { type: 'integer' },
                            max_endpoint_count: { type: 'integer' },
                            cpu_count: { type: 'number' },
                            cpu_usage: { type: 'number' },
                            memory_usage: { type: 'number' },
                            last_report_time: { idate: true },
                        }
                    }
                }
            }
        },

        restriction_enum: {
            type: 'string',
            enum: [
                "dns_name",
                "dns_server",
                "time_config",
                "attach_server",
                "peer_to_peer_ports",
                "server_details",
                "cluster_connectivity_ip",
                "toggle_endpoint_agent"
            ],
        },

        role_info: {
            type: 'object',
            required: ['roles', 'account'],
            properties: {
                roles: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/role_enum'
                    }
                },
                account: {
                    type: 'object',
                    required: ['name', 'email'],
                    properties: {
                        name: { $ref: 'common_api#/definitions/account_name' },
                        email: { $ref: 'common_api#/definitions/email' },
                    }
                }
            }
        },


        role_enum: {
            enum: ['admin', 'user', 'operator'],
            type: 'string',
        },


        cluster_info: {
            type: 'object',
            // required: ['count', 'online'],
            properties: {
                master_secret: {
                    type: 'string',
                },
                shards: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            shardname: {
                                type: 'string',
                            },
                            high_availabilty: {
                                type: 'boolean',
                            },
                            servers: {
                                type: 'array',
                                items: {
                                    $ref: '#/definitions/cluster_server_info'
                                }
                            }
                        }
                    }
                },
                min_requirements: {
                    type: 'object',
                    properties: {
                        ram: {
                            type: 'number',
                        },
                        storage: {
                            type: 'number',
                        },
                        cpu_count: {
                            type: 'integer'
                        }
                    }
                }
            }
        },

        cluster_server_info: {
            type: 'object',
            properties: {
                version: {
                    type: 'string'
                },
                secret: {
                    type: 'string',
                },
                status: {
                    type: 'string',
                    enum: ['CONNECTED', 'DISCONNECTED', 'IN_PROGRESS']
                },
                hostname: {
                    type: 'string'
                },
                addresses: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },
                memory: {
                    type: 'object',
                    required: ['total', 'free', 'used'],
                    properties: {
                        total: {
                            type: 'number'
                        },
                        used: {
                            type: 'number'
                        },
                        free: {
                            type: 'number'
                        }
                    }
                },
                storage: {
                    $ref: 'common_api#/definitions/storage_info'
                },
                cpus: {
                    type: 'object',
                    required: ['count', 'usage'],
                    properties: {
                        count: {
                            type: 'number'
                        },
                        usage: {
                            type: 'number'
                        }
                    }
                },
                location: {
                    type: 'string'
                },
                time_epoch: {
                    idate: true
                },
                timezone: {
                    type: 'string'
                },
                dns_servers: {
                    type: 'array',
                    items: {
                        type: 'string'
                    },
                },
                debug: {
                    type: 'object',
                    required: ['level'],
                    properties: {
                        level: {
                            type: 'integer',
                        },
                        time_left: { // in ms
                            type: 'integer'
                        },
                    },
                },
                services_status: {
                    $ref: '#/definitions/services_status'
                },
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
                            type: 'object',
                            properties: {
                                message: {
                                    type: 'string'
                                },
                                report_info: {
                                    type: 'string'
                                }
                            }
                        },
                        initiator_email: { $ref: 'common_api#/definitions/email' },
                        tested_date: {
                            idate: true
                        },
                        staged_package: {
                            type: 'string'
                        },
                        package_uploaded: {
                            idate: true
                        },
                    },
                },
            }
        },

        services_status: {
            type: 'object',
            required: ['phonehome_server', 'cluster_communication'],
            properties: {
                dns_servers: {
                    $ref: '#/definitions/service_status_enum'
                },
                dns_name_resolution: {
                    $ref: '#/definitions/service_status_enum'
                },
                phonehome_server: {
                    $ref: '#/definitions/service_dated_status'
                },
                cluster_communication: {
                    type: 'object',
                    properties: {
                        test_completed: {
                            type: 'boolean'
                        },
                        results: {
                            type: 'array',
                            items: {
                                type: 'object',
                                required: ['secret', 'status'],
                                properties: {
                                    secret: {
                                        type: 'string'
                                    },
                                    status: {
                                        $ref: '#/definitions/service_status_enum'
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

        service_status_enum: {
            type: 'string',
            enum: ['UNKNOWN', 'FAULTY', 'UNREACHABLE', 'OPERATIONAL']
        },

        service_dated_status: {
            type: 'object',
            properties: {
                status: {
                    $ref: '#/definitions/service_status_enum'
                },
                test_time: {
                    idate: true
                },
            }
        }
    }
};
