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

        create_system: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string',
                    },
                },
            },
            reply: {
                type: 'object',
                required: ['token', 'info'],
                properties: {
                    token: {
                        type: 'string',
                    },
                    info: {
                        $ref: '#/definitions/system_info'
                    },
                }
            },
            auth: {
                system: false,
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
                system: false,
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
                    email: {
                        type: 'string',
                    },
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
                    email: {
                        type: 'string',
                    },
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
                        format: 'idate',
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        export_activity_log: {
            method: 'GET',
            params: {
                type: 'object',
                required: [],
                properties: {
                    event: {
                        type: 'string',
                    },
                    events: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                    till: {
                        format: 'idate'
                    },
                    since: {
                        format: 'idate'
                    }
                }
            },
            reply: {
                type: 'string',
            },
            auth: {
                system: 'admin',
            }
        },

        read_activity_log: {
            method: 'GET',
            params: {
                type: 'object',
                required: [],
                properties: {
                    event: {
                        type: 'string',
                    },
                    events: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                    till: {
                        format: 'idate'
                    },
                    since: {
                        format: 'idate'
                    },
                    skip: {
                        type: 'integer',
                    },
                    limit: {
                        type: 'integer',
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['logs'],
                properties: {
                    logs: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['id', 'time', 'level', 'event'],
                            properties: {
                                id: {
                                    type: 'string',
                                },
                                time: {
                                    format: 'idate'
                                },
                                level: {
                                    type: 'string',
                                },
                                event: {
                                    type: 'string',
                                },
                                tier: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: {
                                            type: 'string'
                                        }
                                    }
                                },
                                node: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: {
                                            type: 'string'
                                        }
                                    }
                                },
                                bucket: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: {
                                            type: 'string'
                                        }
                                    }
                                },
                                pool: {
                                    type: 'object',
                                    required: ['name'],
                                    properties: {
                                        name: {
                                            type: 'string'
                                        }
                                    }
                                },
                                obj: {
                                    type: 'object',
                                    required: ['key'],
                                    properties: {
                                        key: {
                                            type: 'string'
                                        }
                                    }
                                },
                                account: {
                                    type: 'object',
                                    required: ['email'],
                                    properties: {
                                        email: {
                                            type: 'string'
                                        }
                                    }
                                },
                                actor: {
                                    type: 'object',
                                    required: ['email'],
                                    properties: {
                                        email: {
                                            type: 'string'
                                        }
                                    }
                                },
                                desc: {
                                    type: 'array',
                                    items: {
                                        type: 'string',
                                    }
                                },
                            }
                        }
                    },
                }
            },
            auth: {
                system: 'admin',
            }
        },

        diagnose_system: {
            method: 'GET',
            reply: {
                type: 'string',
            },
            auth: {
                system: 'admin',
            }
        },

        diagnose_node: {
            method: 'GET',
            params: {
                $ref: 'node_api#/definitions/node_identity'
            },
            reply: {
                type: 'string',
            },
            auth: {
                system: 'admin',
            }
        },

        set_debug_level: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['level'],
                properties: {
                    level: {
                        type: 'integer',
                    }
                },
            },
            auth: {
                system: 'admin',
            }
        },

        update_n2n_config: {
            method: 'POST',
            params: {
                $ref: 'common_api#/definitions/n2n_config'
            },
            reply: {
                $ref: '#/definitions/system_nodes_update_reply'
            },
            auth: {
                system: 'admin',
            }
        },

        update_base_address: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['base_address'],
                properties: {
                    base_address: {
                        type: 'string'
                    }
                }
            },
            reply: {
                $ref: '#/definitions/system_nodes_update_reply'
            },
            auth: {
                system: 'admin',
            }
        },

        update_phone_home_config: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['proxy_address'],
                properties: {
                    proxy_address: {
                        anyOf: [{
                            type: 'null'
                        }, {
                            type: 'string'
                        }]
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        },

        configure_remote_syslog: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['enabled'],
                properties: {
                    enabled: {
                        type: 'boolean'
                    },
                    protocol: {
                        type: 'string',
                        enum: ['TCP', 'UDP']
                    },
                    address: {
                        type: 'string'
                    },
                    port: {
                        type: 'number'
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        },

        update_system_certificate: {
            method: 'POST',
            auth: {
                system: 'admin',
            }
        },

        // update_time_config: {
        //     method: 'POST',
        //     params: {
        //         $ref: '#/definitions/time_config'
        //     },
        //     auth: {
        //         system: 'admin',
        //     }
        // },

        update_hostname: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['hostname'],
                properties: {
                    hostname: {
                        type: 'string'
                    }
                }
            },
            reply: {
                $ref: '#/definitions/system_nodes_update_reply'
            },
            auth: {
                system: 'admin',
            }
        },

        upload_upgrade_package: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['filepath'],
                properties: {
                    filepath: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        },

        do_upgrade: {
            method: 'POST',
            auth: {
                system: 'admin',
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
                    format: 'idate',
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
                nodes: {
                    $ref: 'node_api#/definitions/nodes_aggregate_info'
                },
                buckets: {
                    type: 'array',
                    items: {
                        $ref: 'bucket_api#/definitions/bucket_info'
                    }
                },
                pools: {
                    type: 'array',
                    items: {
                        $ref: 'pool_api#/definitions/pool_extended_info'
                    },
                },
                objects: {
                    type: 'integer'
                },
                ssl_port: {
                    type: 'string'
                },
                web_port: {
                    type: 'string'
                },
                web_links: {
                    type: 'object',
                    properties: {
                        agent_installer: {
                            type: 'string',
                        },
                        linux_agent_installer: {
                            type: 'string',
                        },
                        s3rest_installer: {
                            type: 'string',
                        },
                    }
                },
                maintenance_mode: {
                    type: 'object',
                    required: ['state'],
                    properties: {
                        state: {
                            type: 'boolean',
                        },
                        till: {
                            format: 'idate',
                        },
                    }
                },
                n2n_config: {
                    $ref: 'common_api#/definitions/n2n_config'
                },
                ip_address: {
                    type: 'string'
                },
                phone_home_config: {
                    type: 'object',
                    properties: {
                        proxy_address: {
                            anyOf: [{
                                type: 'null'
                            }, {
                                type: 'string'
                            }]
                        }
                    }
                },
                remote_syslog_config: {
                    type: 'object',
                    properties: {
                        protocol: {
                            type: 'string',
                            enum: ['TCP', 'UDP']
                        },
                        address: {
                            type: 'string'
                        },
                        port: {
                            type: 'number'
                        }
                    }
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
                time_config: {
                    type: 'object',
                    properties: {
                        srv_time: {
                            type: 'string'
                        },
                        ntp_server: {
                            type: 'string'
                        },
                        synced: {
                            type: 'boolean'
                        },
                        timezone: {
                            type: 'string'
                        },
                    }
                },
                debug_level: {
                    type: 'integer'
                },
                upgrade: {
                    type: 'object',
                    properties: {
                        status: {
                            type: 'string',
                            enum: ['CAN_UPGRADE', 'FAILED', 'PENDING', 'UNAVAILABLE']
                        },
                        message: {
                            type: 'string',
                        },
                    },
                },
                cluster: {
                    $ref: '#/definitions/cluster_info'
                },
            },
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
                        name: {
                            type: 'string',
                        },
                        email: {
                            type: 'string',
                        },
                    }
                }
            }
        },


        role_enum: {
            enum: ['admin', 'user', 'viewer'],
            type: 'string',
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

        system_nodes_update_reply: {
            type: 'object',
            required: ['nodes_count', 'nodes_updated'],
            properties: {
                nodes_count: {
                    type: 'integer'
                },
                nodes_updated: {
                    type: 'integer'
                }
            }
        },

        // time_config: {
        //     type: 'object',
        //     required: ['config_type', 'timezone'],
        //     properties: {
        //         config_type: {
        //             $ref: '#/definitions/time_config_type'
        //         },
        //         timezone: {
        //             type: 'string'
        //         },
        //         server: {
        //             type: 'string'
        //         },
        //         epoch: {
        //             type: 'number'
        //         },
        //     },
        // },

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
                }
            }
        },

        cluster_server_info: {
            type: 'object',
            properties: {
                version: {
                    type: 'string'
                },
                server_name: {
                    type: 'string'
                },
                is_connected: {
                    type: 'boolean'
                },
                server_ip: {
                    type: 'string'
                },
                memory_usage: {
                    type: 'number'
                },
                cpu_usage: {
                    type: 'number'
                },
            }
        },


        // time_config_type: {
        //     enum: ['NTP', 'MANUAL'],
        //     type: 'string',
        // }
    }
};
