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

        get_agent_info: {
            method: 'PUT',
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
                    base_address: {
                        type: 'string'
                    },
                    rpc_address: {
                        type: 'string'
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
                    is_internal_agent: {
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

        update_rpc_address: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['rpc_address'],
                properties: {
                    rpc_address: {
                        type: 'string'
                    }
                }
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
            }
        },

        update_n2n_config: {
            method: 'POST',
            params: {
                $ref: 'common_api#/definitions/n2n_config'
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

        test_disk_write: {
            method: 'POST',
            reply: {
                $ref: 'node_api#/definitions/latency_array'
            }
        },

        test_disk_read: {
            method: 'POST',
            reply: {
                $ref: 'node_api#/definitions/latency_array'
            }
        },

        test_network_io: {
            method: 'POST',
            param_raw: 'data',
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
                        format: 'buffer'
                    }
                },
            },
            reply: {
                type: 'object',
                required: ['data'],
                properties: {
                    data: {
                        format: 'buffer'
                    },
                },
            },
        },

        test_network_to_peer: {
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
                        format: 'buffer'
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
