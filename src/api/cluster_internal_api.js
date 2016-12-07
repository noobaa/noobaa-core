'use strict';

/**
 *
 * CLUSTER INTERNAL API
 *
 * Cluster & HA
 *
 */
module.exports = {

    id: 'cluster_internal_api',

    methods: {
        join_to_cluster: {
            doc: 'direct current server to join to the cluster',
            method: 'POST',
            params: {
                type: 'object',
                required: ['topology', 'cluster_id', 'secret', 'role', 'shard', 'jwt_secret'],
                properties: {
                    ip: {
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
                    }
                }
            },
            auth: {
                system: false
            }
        },

        verify_join_conditions: {
            doc: 'check join conditions to the cluster and return caller ip (stun)',
            method: 'POST',
            params: {
                type: 'object',
                required: ['secret', 'version'],
                properties: {
                    secret: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    }
                }
            },
            reply: {
                type: 'object',
                required: ['caller_address'],
                properties: {
                    caller_address: {
                        type: 'string'
                    }
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

        apply_updated_time_config: {
            method: 'POST',
            params: {
                $ref: '#/definitions/time_config'
            },
            auth: {
                system: false,
            }
        },

        apply_updated_dns_servers: {
            method: 'POST',
            params: {
                $ref: '#/definitions/dns_servers_config'
            },
            auth: {
                system: false,
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
                format: 'idate',
            },
            auth: {
                system: false,
            }
        },

        upgrade_cluster: {
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
                system: false,
            }
        },

        member_pre_upgrade: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['filepath', 'mongo_upgrade'],
                properties: {
                    filepath: {
                        type: 'string'
                    },
                    mongo_upgrade: {
                        type: 'boolean'
                    }
                }
            },
            auth: {
                system: false,
            }
        },

        do_upgrade: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    filepath: {
                        type: 'string'
                    }
                }
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
        }
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
                ntp_server: {
                    type: 'string'
                },
                epoch: {
                    type: 'number'
                },
            },
        },

        dns_servers_config: {
            type: 'object',
            required: ['dns_servers'],
            properties: {
                target_secret: {
                    type: 'string'
                },
                dns_servers: {
                    type: 'array',
                    items: {
                        type: 'string'
                    },
                },
            },
        }
    },
};
