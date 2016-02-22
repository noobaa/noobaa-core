'use strict';

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
module.exports = {

    id: 'node_api',

    methods: {

        create_node: {
            method: 'POST',
            params: {
                $ref: '#/definitions/node_config'
            },
            reply: {
                type: 'object',
                required: ['id', 'peer_id', 'token'],
                properties: {
                    id: {
                        type: 'string'
                    },
                    peer_id: {
                        type: 'string'
                    },
                    token: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: ['admin', 'create_node']
            }
        },

        read_node: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    }
                }
            },
            reply: {
                $ref: '#/definitions/node_full_info'
            },
            auth: {
                system: 'admin'
            }
        },

        update_node: {
            method: 'PUT',
            params: {
                $ref: '#/definitions/node_config'
            },
            auth: {
                system: 'admin'
            }
        },

        delete_node: {
            method: 'DELETE',
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

        read_node_maps: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    skip: {
                        type: 'integer'
                    },
                    limit: {
                        type: 'integer'
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['node', 'objects'],
                properties: {
                    node: {
                        $ref: '#/definitions/node_full_info'
                    },
                    objects: {
                        type: 'array',
                        items: {
                            type: 'object',
                            // required: [],
                            properties: {
                                key: {
                                    type: 'string'
                                },
                                bucket: {
                                    type: 'string'
                                },
                                parts: {
                                    type: 'array',
                                    items: {
                                        $ref: 'object_api#/definitions/part_info'
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

        list_nodes: {
            method: 'GET',
            params: {
                type: 'object',
                // required: [],
                properties: {
                    query: {
                        type: 'object',
                        // required: [],
                        properties: {
                            pools: {
                                type: 'array',
                                items: {
                                    type: 'string',
                                },
                            },
                            name: {
                                // regexp
                                type: 'string'
                            },
                            geolocation: {
                                // regexp
                                type: 'string'
                            },
                            state: {
                                type: 'string',
                                enum: ['online', 'offline']
                            },
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
                        enum: ['state', 'name', 'ip', 'capacity', 'hd', 'trust', 'online']
                    },
                    order: {
                        type: 'integer',
                    },
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

        group_nodes: {
            method: 'GET',
            params: {
                type: 'object',
                // required: [],
                properties: {
                    group_by: {
                        type: 'object',
                        // required: [],
                        properties: {
                            pool: {
                                type: 'boolean'
                            },
                            geolocation: {
                                type: 'boolean'
                            },
                        }
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['groups'],
                properties: {
                    groups: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['count'],
                            properties: {
                                pool: {
                                    type: 'string'
                                },
                                geolocation: {
                                    type: 'string'
                                },
                                count: {
                                    type: 'integer'
                                },
                                online: {
                                    type: 'integer'
                                },
                                storage: {
                                    $ref: 'common_api#/definitions/storage_info'
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


        heartbeat: {
            method: 'PUT',
            params: {
                type: 'object',
                required: [
                    'version',
                    // do not require more fields! see explaination -
                    // the heartbeat request should require the minimal fields
                    // since on upgrades the agents are still running old version
                    // and the heartbeat is the one that should let them know they
                    // should pull the new version, so it should not fail on missing/extra fields.
                ],
                properties: {
                    //0.4 backward compatibility. allows id and port for old agents
                    //will return simple reply that will result with agent upgrade
                    id: {
                        type: 'string'
                    },
                    port: {
                        type: 'integer'
                    },
                    name: {
                        type: 'string'
                    },
                    geolocation: {
                        type: 'string'
                    },
                    ip: {
                        type: 'string'
                    },
                    base_address: {
                        type: 'string'
                    },
                    rpc_address: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    },
                    extended_hb: {
                        type: 'boolean'
                    },
                    storage: {
                        $ref: 'common_api#/definitions/storage_info'
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
                }
            },
            reply: {
                type: 'object',
                required: [
                    'version',
                    // do not require more fields! see explaination -
                    // the heartbeat reply should require the minimal fields
                    // since on upgrades the agents are still running old version
                    // and the heartbeat is the one that should let them know they
                    // should pull the new version, so it should not fail on missing/extra fields.
                ],
                properties: {
                    auth_token: {
                        // auth token will only be sent back if new node was created
                        type: 'string'
                    },
                    rpc_address: {
                        type: 'string'
                    },
                    n2n_config: {
                        $ref: 'common_api#/definitions/n2n_config'
                    },
                    version: {
                        type: 'string'
                    },
                    delay_ms: {
                        type: 'integer'
                    },
                    storage: {
                        $ref: 'common_api#/definitions/storage_info'
                    },
                }
            },
            auth: {
                system: ['admin', 'agent', 'create_node']
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

        redirect: {
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

        self_test_to_node_via_web: {
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
                type: 'object',
                required: ['target'],
                properties: {
                    target: {
                        type: 'string'
                    }
                },
            },
            reply: {
                type: 'string',
            },
            auth: {
                system: 'admin',
            }
        },

        set_debug_node: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['target'],
                properties: {
                    target: {
                        type: 'string',
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        },

        test_latency_to_server: {
            method: 'POST',
            auth: {
                system: ['admin', 'agent', 'create_node']
            }
        },

        max_node_capacity: {
            method: 'GET',
            reply: {
                type: 'integer'
            },
            auth: {
                system: 'admin',
            }
        },

        get_test_nodes: {
            method: 'GET',
            params: {
                type: 'object',
                required: ['count'],
                properties: {
                    count: {
                        type: 'integer',
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
        }

    },


    definitions: {

        node_config: {
            type: 'object',
            required: ['name'],
            properties: {
                name: {
                    type: 'string',
                },
                is_server: {
                    type: 'boolean',
                },
                geolocation: {
                    type: 'string',
                },
                srvmode: {
                    $ref: '#/definitions/srvmode'
                }
            }
        },

        srvmode: {
            type: 'string',
            enum: ['connect', 'disabled', 'decommissioning', 'decommissioned']
        },

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
                geolocation: {
                    type: 'string'
                },
                srvmode: {
                    $ref: '#/definitions/srvmode'
                },
                rpc_address: {
                    type: 'string'
                },
                base_address: {
                    type: 'string'
                },
                peer_id: {
                    type: 'string'
                },
                ip: {
                    type: 'string'
                },
                online: {
                    type: 'boolean',
                },
                heartbeat: {
                    type: 'integer',
                    format: 'idate',
                },
                version: {
                    type: 'string'
                },
                storage: {
                    $ref: 'common_api#/definitions/storage_info'
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
                }
            }
        },

        signal_params: {
            type: 'object',
            required: ['target'],
            additionalProperties: true,
            properties: {
                target: {
                    type: 'string'
                },
            },
        },

        signal_reply: {
            type: 'object',
            additionalProperties: true,
        },

        latency_array: {
            type: 'array',
            items: {
                type: 'number',
            }
        }

    }

};
