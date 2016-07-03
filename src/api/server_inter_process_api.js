'use strict';

/**
 *
 * CLUSTER MEMBER API
 *
 *
 */
module.exports = {

    id: 'server_inter_process_api',

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
                type: 'object',
                properties: {
                    rs_name: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: false
            }
        }
    }
};
