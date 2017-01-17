'use strict';

/**
 *
 * CLUSTER SERVER API
 *
 * Cluster & HA
 *
 */
module.exports = {

    id: 'cluster_server_api',

    methods: {
        add_member_to_cluster: {
            doc: 'Add new member to the cluster',
            method: 'POST',
            params: {
                type: 'object',
                required: ['address', 'secret', 'role', 'shard'],
                properties: {
                    address: {
                        type: 'string',
                    },
                    secret: {
                        type: 'string'
                    },
                    role: {
                        $ref: '#/definitions/cluster_member_role'
                    },
                    shard: {
                        type: 'string'
                    },
                    location: {
                        type: 'string'
                    },
                    new_hostname: {
                        type: 'string'
                    }
                },
            },
            auth: {
                system: 'admin'
            },
        },

        update_time_config: {
            method: 'POST',
            params: {
                $ref: 'cluster_internal_api#/definitions/time_config'
            },
            auth: {
                system: 'admin',
            }
        },

        update_dns_servers: {
            method: 'POST',
            params: {
                $ref: 'cluster_internal_api#/definitions/dns_servers_config'
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

        diagnose_system: {
            method: 'GET',
            params: {
                type: 'object',
                properties: {
                    target_secret: {
                        type: 'string',
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

        read_server_time: {
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
                system: 'admin',
            }
        },

        read_server_config: {
            method: 'GET',
            reply: {
                type: 'object',
                required: ['using_dhcp', 'phone_home_connectivity_status'],
                properties: {
                    ntp_server: {
                        type: 'string'
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
                    using_dhcp: {
                        type: 'boolean'
                    },
                    phone_home_connectivity_status: {
                        enum: [
                            'CANNOT_REACH_DNS_SERVER',
                            'CANNOT_RESOLVE_PHONEHOME_NAME',
                            'CANNOT_CONNECT_INTERNET',
                            'CANNOT_CONNECT_PHONEHOME_SERVER',
                            'MALFORMED_RESPONSE',
                            'CONNECTED'
                        ],
                        type: 'string',
                    },
                }
            },
            auth: {
                account: false,
                system: false,
            }
        },

        update_server_conf: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['target_secret'],
                properties: {
                    target_secret: {
                        type: 'string'
                    },
                    hostname: {
                        type: 'string'
                    },
                    location: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: 'admin',
            }
        },

        check_cluster_status: {
            method: 'GET',
            reply: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['secret', 'status'],
                    properties: {
                        secret: {
                            type: 'string'
                        },
                        status: {
                            $ref: 'system_api#/definitions/service_status_enum'
                        }
                    }
                }
            },
            auth: {
                system: false
            }
        },

        verify_candidate_join_conditions: {
            doc: 'check join conditions to the cluster for specified server and return its hostname',
            method: 'POST',
            params: {
                type: 'object',
                required: ['address', 'secret'],
                properties: {
                    address: {
                        type: 'string',
                    },
                    secret: {
                        type: 'string'
                    },
                }
            },
            reply: {
                type: 'object',
                required: ['result'],
                properties: {
                    result: {
                        $ref: '#/definitions/verify_new_member_result'
                    },
                    hostname: {
                        type: 'string'
                    },
                    version: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: false
            }
        },

        ping: {
            method: 'GET',
            reply: {
                enum: ['PONG'],
                type: 'string'
            },
            auth: {
                system: false
            }
        }
    },

    definitions: {
        cluster_member_role: {
            enum: ['SHARD', 'REPLICA'],
            type: 'string',
        },

        verify_new_member_result: {
            enum: ['OKAY', 'SECRET_MISMATCH', 'VERSION_MISMATCH', 'ALREADY_A_MEMBER', 'HAS_OBJECTS', 'UNREACHABLE'],
            type: 'string'
        }
    },
};
