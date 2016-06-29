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

        read_node: {
            method: 'GET',
            params: {
                $ref: '#/definitions/node_identity'
            },
            reply: {
                $ref: '#/definitions/node_full_info'
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
                            'data_activity'
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
                    nodes: {
                        type: 'array',
                        items: {
                            $ref: '#/definitions/node_full_info'
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
                properties: {
                    nodes: {
                        $ref: '#/definitions/nodes_aggregate_info'
                    },
                    storage: {
                        $ref: 'common_api#/definitions/storage_info'
                    },
                    groups: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: {
                                    type: 'string',
                                },
                                nodes: {
                                    $ref: '#/definitions/nodes_aggregate_info'
                                },
                                storage: {
                                    $ref: 'common_api#/definitions/storage_info'
                                },
                            }
                        }
                    },
                }
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

        report_node_block_error: {
            method: 'POST',
            params: {
                type: 'object',
                required: [
                    'action',
                    'block_md'
                ],
                properties: {
                    action: {
                        type: 'string',
                        enum: ['write', 'read'],
                    },
                    block_md: {
                        $ref: 'common_api#/definitions/block_md'
                    },
                },
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

        node_full_info: {
            type: 'object',
            required: [
                'id',
                'name',
                'pool',
                'rpc_address',
                'peer_id',
                'ip',
                'online',
                'heartbeat',
                'version',
                'storage',
            ],
            properties: {
                id: {
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
                    type: 'object',
                    required: ['reason'],
                    properties: {
                        reason: {
                            $ref: '#/definitions/data_activity_type'
                        },
                        // stage: {
                        //     type: 'string',
                        //     enum: ['REBUILDING', 'WIPING']
                        // },
                        // pending: {
                        //     type: 'boolean'
                        // },
                        completed_size: {
                            type: 'number',
                        },
                        remaining_size: {
                            type: 'number',
                        },
                        start_time: {
                            format: 'idate'
                        },
                        remaining_time: {
                            format: 'idate'
                        },
                    }
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
            }
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

        data_activity_type: {
            type: 'string',
            enum: [
                'RESTORING',
                'FREEING_SPACE',
                'MIGRATING',
                'DECOMMISSIONING',
                'DELETING'
            ]
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
            }
        }

    }

};
