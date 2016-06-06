'use strict';

/**
 *
 * CLUSTER MEMBER API
 *
 *
 */
module.exports = {

    id: 'cluster_member_api',

    methods: {
        load_system_store: {
            method: 'POST',
            auth: {
                system: false
            }
        },

        update_mongo_connection_string: {
            method: 'POST',
            params: {
                rs_name: {
                    type: 'string',
                },
            },
            auth: {
                system: false
            }
        }
    }
};
