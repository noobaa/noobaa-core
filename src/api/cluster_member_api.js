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
    }
};
