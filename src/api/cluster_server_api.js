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
                        type: 'string',
                    }
                },
            },
            auth: {
                system: 'admin'
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
