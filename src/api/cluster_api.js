'use strict';

/**
 *
 * CLUSTER API
 *
 * Cluster & HA
 *
 */
module.exports = {

    id: 'cluster_api',

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

        load_system_store: {
            method: 'POST',
            auth: {
                system: false
            }
        },

    },
};
