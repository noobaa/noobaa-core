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

        get_cluster_id: {
            doc: 'Read cluster id',
            method: 'GET',

            reply: {
                type: 'object',
                required: ['cluster_id'],
                properties: {
                    cluster_id: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

        add_member_to_cluster: {
            doc: 'Add new member to the cluster',
            method: 'POST',
            params: {
                type: 'object',
                required: ['ip', 'secret', 'role', 'shard'],
                properties: {
                    ip: {
                        type: 'string',
                    },
                    secret: {
                        type: 'string'
                    },
                    role: {
                        $ref: '#/definitions/cluster_member_role'
                    },
                    shard: {
                        type: 'string',
                    }
                },
            },
            auth: {
                system: 'admin'
            }
        },

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
                        $ref: '#/definitions/cluster_member_role'
                    },
                    shard: {
                        type: 'string',
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
                            type: 'string',
                        },
                    },
                    cluster_id: {
                        type: 'string'
                    },
                },
            },
        },

        news_updated_topology: {
            doc: 'published updated clustering topology info',
            method: 'POST',
            params: {
                type: 'object',
                additionalProperties: true,
                properties: {}
            },
        },

        heartbeat: {
            doc: 'HB passed between members of the cluster',
            method: 'POST',

        }

    },
    definitions: {
        cluster_member_role: {
            enum: ['SHARD', 'REPLICA'],
            type: 'string',
        },
    },
};
