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


    },
    definitions: {
        cluster_member_role: {
            enum: ['SHARD', 'REPLICA'],
            type: 'string',
        },
    },
};
