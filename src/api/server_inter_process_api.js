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
                    skip_load_system_store: {
                        type: 'boolean'
                    }
                }
            },
            auth: {
                system: false
            }
        },

        update_master_change: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    master_address: {
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
