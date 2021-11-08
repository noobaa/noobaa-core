/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * CLUSTER INTERNAL API
 *
 * Cluster & HA
 *
 */
module.exports = {

    $id: 'cluster_internal_api',

    methods: {
        join_to_cluster: {
            doc: 'direct current server to join to the cluster',
            method: 'POST',
            params: {
                type: 'object',
                required: ['topology', 'master_ip', 'cluster_id', 'secret', 'role', 'shard', 'jwt_secret', 'ssl_certs'],
                properties: {
                    ip: {
                        type: 'string',
                    },
                    master_ip: {
                        type: 'string',
                    },
                    cluster_id: {
                        type: 'string'
                    },
                    secret: {
                        type: 'string'
                    },
                    jwt_secret: {
                        type: 'string'
                    },
                    role: {
                        $ref: 'cluster_server_api#/definitions/cluster_member_role'
                    },
                    shard: {
                        type: 'string',
                    },
                    location: {
                        type: 'string'
                    },
                    topology: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    },
                    new_hostname: {
                        type: 'string'
                    },
                    ssl_certs: {
                        type: 'object',
                        required: ['root_ca', 'server_cert', 'client_cert'],
                        properties: {
                            root_ca: {
                                type: 'string'
                            },
                            server_cert: {
                                type: 'string'
                            },
                            client_cert: {
                                type: 'string'
                            },
                        }
                    }
                }
            },
            auth: {
                system: false
            }
        },

        verify_join_conditions: {
            doc: 'check join conditions to the cluster and return caller ip (stun)',
            method: 'GET',
            params: {
                type: 'object',
                required: ['secret'],
                properties: {
                    secret: {
                        type: 'string'
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['caller_address', 'hostname', 'result'],
                properties: {
                    caller_address: {
                        type: 'string'
                    },
                    hostname: {
                        type: 'string'
                    },
                    result: {
                        $ref: 'cluster_server_api#/definitions/verify_new_member_result'
                    }
                }
            },
            auth: {
                system: false
            }
        },

        get_secret: {
            doc: 'get server secret',
            method: 'GET',
            reply: {
                type: 'object',
                required: ['secret'],
                properties: {
                    secret: {
                        type: 'string'
                    },
                }
            },
            auth: {
                system: false
            }
        },

        get_version: {
            doc: 'get server version',
            method: 'GET',
            reply: {
                type: 'object',
                required: ['version'],
                properties: {
                    version: {
                        type: 'string'
                    },
                }
            },
            auth: {
                system: false
            }
        },

        news_config_servers: {
            doc: 'published the config server IPs to the cluster',
            method: 'POST',
            params: {
                type: 'object',
                required: ['IPs', 'cluster_id'],
                properties: {
                    IPs: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                address: {
                                    type: 'string'
                                },
                            }
                        },
                    },
                    cluster_id: {
                        type: 'string'
                    },
                },
            },
            auth: {
                system: false
            }
        },

        redirect_to_cluster_master: {
            doc: 'redirect to master server to our knowledge',
            method: 'GET',
            reply: {
                type: 'string',
            },
            auth: {
                system: false
            }
        },

        news_updated_topology: {
            doc: 'published updated clustering topology info',
            method: 'POST',
            params: {
                type: 'object',
                additionalProperties: true,
                properties: {}
            },
            auth: {
                system: false
            }
        },

        news_replicaset_servers: {
            doc: 'published updated replica set clustering topology info',
            method: 'POST',
            params: {
                type: 'object',
                additionalProperties: true,
                properties: {}
            },
            auth: {
                system: false
            }
        },

        apply_set_debug_level: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['level'],
                properties: {
                    target_secret: {
                        type: 'string',
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

        collect_server_diagnostics: {
            method: 'POST',
            reply: {
                type: 'object',
                properties: {
                    // [RPC_BUFFERS].data
                },
            },
            auth: {
                system: 'admin',
            }
        },

        apply_read_server_time: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['target_secret'],
                properties: {
                    target_secret: {
                        type: 'string',
                    }
                },
            },
            reply: {
                idate: true,
            },
            auth: {
                system: false,
            }
        },

        set_hostname_internal: {
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
            auth: {
                system: false,
            }
        },

    },

    definitions: {
        time_config: {
            type: 'object',
            required: ['timezone'],
            properties: {
                target_secret: {
                    type: 'string'
                },
                timezone: {
                    type: 'string'
                },
                epoch: {
                    type: 'number'
                },
            },
        },
    },
};
