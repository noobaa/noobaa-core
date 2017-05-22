/* Copyright (C) 2016 NooBaa */
/**
 *
 * AGENT API
 *
 * commands that are sent to an agent (read/write/replicate)
 *
 */
'use strict';

module.exports = {

    id: 'agent_api',

    methods: {

        get_agent_info_and_update_masters: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['addresses'],
                properties: {
                    addresses: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                address: {
                                    type: 'string'
                                },
                            },
                        },
                    },
                },
            },
            reply: {
                type: 'object',
                properties: {
                    version: {
                        type: 'string'
                    },
                    name: {
                        type: 'string'
                    },
                    ip: {
                        type: 'string'
                    },
                    host_id: {
                        type: 'string'
                    },
                    host_name: {
                        type: 'string'
                    },
                    base_address: {
                        type: 'string'
                    },
                    rpc_address: {
                        type: 'string'
                    },
                    n2n_config: {
                        $ref: 'common_api#/definitions/n2n_config'
                    },
                    enabled: {
                        type: 'boolean'
                    },
                    geolocation: {
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
                    debug_level: {
                        type: 'integer',
                    },
                    cloud_pool_name: {
                        type: 'string'
                    },
                    create_node_token: {
                        type: 'string'
                    },

                    // the agent's "recommendation" of it's roles. nodes_monitor will only use it
                    // when initializing the node and the role is not yet known.
                    roles: {
                        type: 'array',
                        items: {
                            $ref: 'common_api#/definitions/agent_roles_enum'
                        }
                    },

                    s3_agent: {
                        type: 'boolean'
                    },
                }
            },
        },

        update_auth_token: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['auth_token'],
                properties: {
                    auth_token: {
                        type: 'string'
                    }
                }
            }
        },

        update_create_node_token: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['create_node_token'],
                properties: {
                    create_node_token: {
                        type: 'string'
                    }
                }
            }
        },

        update_rpc_config: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    rpc_address: {
                        type: 'string'
                    },
                    base_address: {
                        type: 'string'
                    },
                    n2n_config: {
                        $ref: 'common_api#/definitions/n2n_config'
                    }
                }
            }
        },

        update_node_service: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['enabled'],
                properties: {
                    enabled: {
                        type: 'boolean'
                    },
                    ssl_certs: {
                        type: 'object',
                        required: ['key', 'cert'],
                        properties: {
                            key: {
                                type: 'string'
                            },
                            cert: {
                                type: 'string'
                            },
                        }
                    }
                }
            }
        },

        n2n_signal: {
            method: 'POST',
            params: {
                $ref: 'node_api#/definitions/signal_params'
            },
            reply: {
                $ref: 'node_api#/definitions/signal_reply'
            },
        },

        test_store_perf: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    count: {
                        type: 'integer'
                    }
                }
            },
            reply: {
                type: 'object',
                properties: {
                    write: {
                        $ref: 'node_api#/definitions/latency_array'
                    },
                    read: {
                        $ref: 'node_api#/definitions/latency_array'
                    }
                }
            }
        },

        test_network_perf: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['source', 'target', 'response_length'],
                properties: {
                    source: {
                        type: 'string'
                    },
                    target: {
                        type: 'string'
                    },
                    response_length: {
                        type: 'integer'
                    },
                    data: {
                        buffer: true
                    }
                },
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
                n2n: true
            }
        },

        test_network_perf_to_peer: {
            method: 'POST',
            params: {
                $ref: '#/definitions/self_test_params'
            },
            reply: {
                $ref: '#/definitions/self_test_reply'
            },
        },

        collect_diagnostics: {
            method: 'GET',
            reply: {
                type: 'object',
                required: ['data'],
                properties: {
                    data: {
                        buffer: true
                    },
                },
            },
        },

        set_debug_node: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['level'],
                properties: {
                    level: {
                        type: 'integer'
                    }
                }
            }
        },

    },

    definitions: {

        self_test_params: {
            type: 'object',
            required: [
                'source',
                'target',
                'request_length',
                'response_length',
                'count',
                'concur',
            ],
            properties: {
                source: {
                    type: 'string',
                },
                target: {
                    type: 'string',
                },
                request_length: {
                    type: 'integer',
                },
                response_length: {
                    type: 'integer',
                },
                count: {
                    type: 'integer',
                },
                concur: {
                    type: 'integer',
                }
            }
        },

        self_test_reply: {
            type: 'object',
            properties: {
                session: {
                    type: 'string',
                }
            }
        },

    }

};
