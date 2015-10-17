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

    name: 'node_api',

    methods: {

        create_node: {
            method: 'POST',
            params: {
                $ref: '/node_api/definitions/node_config'
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
                $ref: '/node_api/definitions/node_full_info'
            },
            auth: {
                system: 'admin'
            }
        },

        update_node: {
            method: 'PUT',
            params: {
                $ref: '/node_api/definitions/node_config'
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
                        $ref: '/node_api/definitions/node_full_info'
                    },
                    objects: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: [],
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
                                        $ref: '/object_api/definitions/object_part_info'
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
                required: [],
                properties: {
                    query: {
                        type: 'object',
                        required: [],
                        properties: {
                            tier: {
                                type: 'string'
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
                            $ref: '/node_api/definitions/node_full_info'
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
                required: [],
                properties: {
                    group_by: {
                        type: 'object',
                        required: [],
                        properties: {
                            tier: {
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
                                tier: {
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
                                    $ref: '/common_api/definitions/storage_info'
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
                    'ip',
                    'version',
                    'storage',
                ],
                properties: {
                    name: {
                        type: 'string'
                    },
                    geolocation: {
                        type: 'string'
                    },
                    ip: {
                        type: 'string'
                    },
                    rpc_address: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    },
                    storage: {
                        $ref: '/common_api/definitions/storage_info'
                    },
                    drives: {
                        type: 'array',
                        items: {
                            $ref: '/common_api/definitions/drive_info'
                        }
                    },
                    os_info: {
                        $ref: '/common_api/definitions/os_info'
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['rpc_address', 'version', 'delay_ms'],
                properties: {
                    auth_token: {
                        // auth token will only be sent back if new node was created
                        type: 'string'
                    },
                    rpc_address: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    },
                    delay_ms: {
                        type: 'integer'
                    },
                    storage: {
                        $ref: '/common_api/definitions/storage_info'
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
                type: 'object',
                required: ['target'],
                additionalProperties: true,
                properties: {
                    target: {
                        type: 'string'
                    },
                }
            },
            reply: {
                type: 'object',
                required: [],
                additionalProperties: true,
                properties: {}
            },
            auth: {
                system: false
            }
        },

        self_test_to_node_via_web: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['source', 'target', 'request_length', 'response_length'],
                properties: {
                    source: {
                        type: 'string'
                    },
                    target: {
                        type: 'string'
                    },
                    request_length: {
                        type: 'integer'
                    },
                    response_length: {
                        type: 'integer'
                    }
                },
            },
            auth: {
                system: ['admin', 'user']
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
            auth: {
                system: 'admin',
            }
        },

    },


    definitions: {

        node_config: {
            type: 'object',
            required: ['name'],
            properties: {
                name: {
                    type: 'string',
                },
                tier: {
                    type: 'string',
                },
                is_server: {
                    type: 'boolean',
                },
                geolocation: {
                    type: 'string',
                },
                srvmode: {
                    $ref: '/node_api/definitions/srvmode'
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
                'tier',
                'geolocation',
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
                tier: {
                    type: 'string'
                },
                geolocation: {
                    type: 'string'
                },
                srvmode: {
                    $ref: '/node_api/definitions/srvmode'
                },
                rpc_address: {
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
                    $ref: '/common_api/definitions/storage_info'
                },
                drives: {
                    type: 'array',
                    items: {
                        $ref: '/common_api/definitions/drive_info'
                    }
                },
                os_info: {
                    $ref: '/common_api/definitions/os_info'
                },
            }
        }

    }

};
