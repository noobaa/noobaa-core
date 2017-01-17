/**
 *
 * NODE API
 *
 * most are client (currently web client) talking to the web server
 * to work on node usually as admin.
 *
 * the heartbeat is sent from an agent to the web server
 *
 */
'use strict';

module.exports = {

    id: 'node_api',

    methods: {

        heartbeat: {
            // do not define/require more fields!
            // read this explanation -
            // the heartbeat request/reply should not require or verify any fields
            // since on upgrades the agents are still running old version
            // and the heartbeat is the one that should let them know they
            // should pull the new version, so it should not fail on missing/extra fields.
            method: 'PUT',
            params: {
                $ref: '#/definitions/heartbeat_schema_for_upgrade_compatibility'
            },
            reply: {
                $ref: '#/definitions/heartbeat_schema_for_upgrade_compatibility'
            },
            auth: {
                system: false
            }
        },

        test_node_id: {
            method: 'PUT',
            reply: {
                type: 'boolean'
            },
            auth: {
                system: false
            }
        },

        read_node: {
            method: 'GET',
            params: {
                $ref: '#/definitions/node_identity'
            },
            reply: {
                $ref: '#/definitions/node_info'
            },
            auth: {
                system: 'admin'
            }
        },

        decommission_node: {
            method: 'DELETE',
            params: {
                $ref: '#/definitions/node_identity'
            },
            auth: {
                system: 'admin'
            }
        },

        recommission_node: {
            method: 'DELETE',
            params: {
                $ref: '#/definitions/node_identity'
            },
            auth: {
                system: 'admin'
            }
        },

        delete_node: {
            method: 'DELETE',
            params: {
                $ref: '#/definitions/node_identity'
            },
            auth: {
                system: 'admin'
            }
        },

        list_nodes: {
            method: 'GET',
            params: {
                type: 'object',
                // required: [],
                properties: {
                    query: {
                        $ref: '#/definitions/nodes_query'
                    },
                    fields: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                    skip: {
                        type: 'integer'
                    },
                    limit: {
                        type: 'integer'
                    },
                    pagination: {
                        type: 'boolean'
                    },
                    sort: {
                        type: 'string',
                        enum: [
                            'name',
                            'ip',
                            'online',
                            'used',
                            'trusted',
                            'accessibility',
                            'connectivity',
                            'data_activity',
                            'mode'
                        ]
                    },
                    order: {
                        type: 'integer',
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['nodes'],
                properties: {
                    total_count: {
                        type: 'integer'
                    },
                    filter_counts: {
                        $ref: '#/definitions/nodes_aggregate_info'
                    },
                    nodes: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/node_info'
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        aggregate_nodes: {
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    query: {
                        $ref: '#/definitions/nodes_query'
                    },
                    group_by: {
                        type: 'string',
                        enum: ['pool']
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['nodes', 'storage'],
                additionalProperties: true,
                properties: {}
            },
            auth: {
                system: 'admin'
            }
        },

        n2n_signal: {
            method: 'POST',
            params: {
                $ref: '#/definitions/signal_params'
            },
            reply: {
                $ref: '#/definitions/signal_reply'
            },
            auth: {
                system: false
            }
        },

        n2n_proxy: {
            method: 'POST',
            params: {
                $ref: 'common_api#/definitions/proxy_params'
            },
            reply: {
                $ref: 'common_api#/definitions/proxy_reply'
            },
            auth: {
                system: false
            }
        },

        test_node_network: {
            method: 'POST',
            params: {
                $ref: 'agent_api#/definitions/self_test_params'
            },
            reply: {
                $ref: 'agent_api#/definitions/self_test_reply'
            },
            auth: {
                system: ['admin']
            }
        },

        collect_agent_diagnostics: {
            method: 'GET',
            params: {
                $ref: '#/definitions/node_identity'
            },
            reply: {
                type: 'object',
                required: ['data'],
                properties: {
                    data: {
                        buffer: true
                    },
                },
            },
            auth: {
                system: 'admin',
            }
        },

        set_debug_node: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['node', 'level'],
                properties: {
                    node: {
                        $ref: '#/definitions/node_identity'
                    },
                    level: {
                        type: 'integer',
                    }
                },
            },
            auth: {
                system: 'admin',
            }
        },

        ping: {
            method: 'POST',
            auth: {
                system: ['admin', 'agent', 'create_node']
            }
        },

        get_test_nodes: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['count', 'source'],
                properties: {
                    count: {
                        type: 'integer',
                    },
                    source: {
                        type: 'string',
                    },
                }
            },
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['name', 'rpc_address'],
                    properties: {
                        name: {
                            type: 'string'
                        },
                        rpc_address: {
                            type: 'string'
                        }
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        },

        allocate_nodes: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['pool_id'],
                properties: {
                    pool_id: {
                        type: 'string'
                    },
                    fields: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['nodes'],
                properties: {
                    nodes: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/node_info'
                        }
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        migrate_nodes_to_pool: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['nodes', 'pool_id'],
                properties: {
                    nodes: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/node_identity'
                        }
                    },
                    pool_id: {
                        type: 'string'
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },

        report_error_on_node_blocks: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['blocks_report'],
                properties: {
                    blocks_report: {
                        $ref: 'common_api#/definitions/blocks_report'
                    }
                }
            },
            auth: {
                system: ['admin', 'user', 'agent']
            }
        },

        sync_monitor_to_store: {
            method: 'PUT',
            auth: {
                system: 'admin'
            }
        },

    },


    definitions: {

        node_info: {
            type: 'object',
            required: ['_id'],
            properties: {
                _id: {
                    type: 'string'
                },
                name: {
                    type: 'string'
                },
                pool: {
                    type: 'string'
                },
                peer_id: {
                    type: 'string'
                },
                is_cloud_node: {
                    type: 'boolean'
                },
                demo_node: {
                    type: 'boolean'
                },
                geolocation: {
                    type: 'string'
                },
                rpc_address: {
                    type: 'string'
                },
                base_address: {
                    type: 'string'
                },
                ip: {
                    type: 'string'
                },
                host_id: {
                    type: 'string'
                },
                version: {
                    type: 'string'
                },
                version_install_time: {
                    format: 'idate'
                },
                heartbeat: {
                    format: 'idate'
                },
                has_issues: {
                    type: 'boolean',
                },
                online: {
                    type: 'boolean',
                },
                readable: {
                    type: 'boolean',
                },
                writable: {
                    type: 'boolean',
                },
                trusted: {
                    type: 'boolean',
                },
                n2n_connectivity: {
                    type: 'boolean',
                },
                migrating_to_pool: {
                    format: 'idate'
                },
                decommissioning: {
                    format: 'idate'
                },
                decommissioned: {
                    format: 'idate'
                },
                deleting: {
                    format: 'idate'
                },
                deleted: {
                    format: 'idate'
                },
                accessibility: {
                    $ref: '#/definitions/accessibility_type'
                },
                connectivity: {
                    $ref: '#/definitions/connectivity_type'
                },
                data_activity: {
                    $ref: '#/definitions/data_activity'
                },
                storage: {
                    $ref: 'common_api#/definitions/storage_info'
                },
                storage_full: {
                    type: 'boolean',
                },
                drives: {
                    type: 'array',
                    items: {
                        $ref: 'common_api#/definitions/drive_info'
                    }
                },
                os_info: {
                    $ref: 'common_api#/definitions/os_info'
                },
                latency_to_server: {
                    $ref: '#/definitions/latency_array'
                },
                latency_of_disk_write: {
                    $ref: '#/definitions/latency_array'
                },
                latency_of_disk_read: {
                    $ref: '#/definitions/latency_array'
                },
                debug_level: {
                    type: 'integer',
                },
                suggested_pool: {
                    type: 'string'
                },
                mode: {
                    $ref: '#/definitions/node_mode'
                }
            }
        },

        node_mode: {
            type: 'string',
            enum: [
                'OFFLINE',
                'UNTRUSTED',
                'INITALIZING',
                'DELETING',
                'DELETED',
                'DECOMMISSIONED',
                'DECOMMISSIONING',
                'MIGRATING',
                'N2N_ERRORS',
                'GATEWAY_ERRORS',
                'IO_ERRORS',
                'LOW_CAPACITY',
                'NO_CAPACITY',
                'OPTIMAL',
            ]
        },


        node_identity: {
            type: 'object',
            properties: {
                id: {
                    type: 'string'
                },
                name: {
                    type: 'string'
                },
                peer_id: {
                    type: 'string'
                },
                rpc_address: {
                    type: 'string'
                },
            }
        },

        nodes_query: {
            type: 'object',
            properties: {
                nodes: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/node_identity'
                    }
                },
                pools: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                },
                filter: {
                    // regexp on name & ip
                    type: 'string'
                },
                geolocation: {
                    // regexp
                    type: 'string'
                },
                has_issues: {
                    type: 'boolean',
                },
                online: {
                    type: 'boolean',
                },
                readable: {
                    type: 'boolean',
                },
                writable: {
                    type: 'boolean',
                },
                trusted: {
                    type: 'boolean',
                },
                migrating_to_pool: {
                    type: 'boolean'
                },
                decommissioning: {
                    type: 'boolean',
                },
                decommissioned: {
                    type: 'boolean',
                },
                deleting: {
                    type: 'boolean',
                },
                deleted: {
                    type: 'boolean',
                },
                skip_internal: {
                    type: 'boolean'
                },
                skip_cloud_nodes: {
                    type: 'boolean'
                },
                accessibility: {
                    $ref: '#/definitions/accessibility_type'
                },
                connectivity: {
                    $ref: '#/definitions/connectivity_type'
                },
                data_activity: {
                    $ref: '#/definitions/data_activity_type'
                },
            }
        },

        nodes_aggregate_info: {
            type: 'object',
            required: [
                'count',
                'online',
                'has_issues'
            ],
            additionalProperties: true,
            properties: {
                count: {
                    type: 'integer'
                },
                online: {
                    type: 'integer'
                },
                has_issues: {
                    type: 'integer'
                },
            }
        },

        data_activity: {
            type: 'object',
            required: ['reason'],
            properties: {
                reason: {
                    $ref: '#/definitions/data_activity_type'
                },
                progress: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                },
                time: {
                    $ref: '#/definitions/time_progress'
                },
                stage: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            enum: [
                                'OFFLINE_GRACE',
                                'REBUILDING',
                                'WIPING',
                            ]
                        },
                        wait_reason: {
                            type: 'string',
                            enum: [
                                'NODE_OFFLINE',
                                'SYSTEM_MAINTENANCE'
                            ]
                        },
                        time: {
                            $ref: '#/definitions/time_progress'
                        },
                        size: {
                            $ref: '#/definitions/size_progress'
                        },
                    }
                },
            }
        },

        data_activities: {
            type: 'array',
            items: {
                type: 'object',
                required: ['reason', 'count'],
                properties: {
                    reason: {
                        $ref: '#/definitions/data_activity_type'
                    },
                    count: {
                        type: 'integer'
                    },
                    progress: {
                        type: 'number',
                        minimum: 0,
                        maximum: 1,
                    },
                    time: {
                        $ref: '#/definitions/time_progress'
                    },
                }
            }
        },


        data_activity_type: {
            type: 'string',
            enum: [
                'RESTORING', // offline
                'MIGRATING', // assign_nodes
                'DECOMMISSIONING', // decommission_node
                'DELETING', // delete_node
            ]
        },

        time_progress: {
            type: 'object',
            properties: {
                start: {
                    format: 'idate',
                },
                end: {
                    format: 'idate',
                },
            }
        },

        size_progress: {
            type: 'object',
            properties: {
                total: {
                    type: 'number',
                },
                remaining: {
                    type: 'number',
                },
                completed: {
                    type: 'number',
                },
            }
        },

        accessibility_type: {
            type: 'string',
            enum: ['FULL_ACCESS', 'READ_ONLY', 'NO_ACCESS']
        },

        connectivity_type: {
            type: 'string',
            enum: ['TCP', 'UDP', 'UNKNOWN']
        },

        signal_params: {
            type: 'object',
            required: ['target'],
            additionalProperties: true,
            properties: {
                target: {
                    type: 'string'
                },
                //Passing params to the actual API done via
                //request_params: {
                //}
            },
        },

        signal_reply: {
            type: 'object',
            additionalProperties: true,
            properties: {}
        },

        latency_array: {
            type: 'array',
            items: {
                type: 'number',
            }
        },

        heartbeat_schema_for_upgrade_compatibility: {
            type: 'object',
            additionalProperties: true,
            properties: {
                // the only field we use now is version.
                // however since we want to avoid any kind of upgrade
                // compatibility issues in the future, we leave this schema
                // completely open, so that both the upgraded server and the
                // under-graded agent will not reject each others request/reply
                // version: {type:'string'}
                // For HA purposes, we also want to redirect an agent to the current master server in the cluster
                // Thus adding the following to the reply
                // redirect: {type: 'string'}
            }
        }

    }

};
