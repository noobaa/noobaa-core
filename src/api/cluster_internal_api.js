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
                required: ['topology', 'cluster_id', 'secret', 'role', 'shard'],
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
                type: 'object',
                properties: {
                    time_config: {
                        $ref: '#/definitions/time_config'
                    }
                }
            },
            auth: {
                system: false,
            }
        },

        apply_updated_dns_servers: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    dns_servers: {
                        type: 'array',
                        items: {
                            type: 'string'
                        },
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
            required: ['config_type', 'timezone'],
            properties: {
                config_type: {
                    $ref: '#/definitions/time_config_type'
                },
                timezone: {
                    type: 'string'
                },
                server: {
                    type: 'string'
                },
                epoch: {
                    type: 'number'
                },
            },
        },

        time_config_type: {
            enum: ['NTP', 'MANUAL'],
            type: 'string',
        }
    },
};
