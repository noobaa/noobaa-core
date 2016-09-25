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
                    }
                },
            },
            auth: {
                system: 'admin'
            }
        },

        update_server_location: {
            doc: 'Add new member to the cluster',
            method: 'POST',
            params: {
                type: 'object',
                required: ['secret', 'location'],
                properties: {
                    secret: {
                        type: 'string',
                    },
                    location: {
                        type: 'string'
                    }
                },
            },
            auth: {
                system: 'admin',
            }
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
            method: 'POST',
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
        }
    },

    definitions: {
        cluster_member_role: {
            enum: ['SHARD', 'REPLICA'],
            type: 'string',
        },
    },
};
