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

        add_members_to_cluster: {
            doc: 'Add new members to the cluster',
            method: 'POST',
            params: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        ip: {
                            type: 'string',
                        },
                        secret: {
                            type: 'string'
                        },
                    },
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
                required: ['ips', 'cluster_id', 'secret'],
                properties: {
                    ips: {
                        type: 'array',
                        items: {
                            type: 'string',
                        }
                    },
                    cluster_id: {
                        type: 'string'
                    },
                    secret: {
                        type: 'string'
                    },
                }
            },
            auth: {
                system: false
            }
        },

        heartbeat: {
          doc: 'HB passed between members of the cluster',
          method: 'POST',
          
        }

    },
};
