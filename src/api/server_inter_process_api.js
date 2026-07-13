/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * CLUSTER MEMBER API
 *
 *
 */
module.exports = {

    $id: 'server_inter_process_api',

    methods: {
        load_system_store: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    since: { idate: true },
                    load_source: {
                        type: 'string',
                        enum: ['DB', 'CORE']
                    }
                }
            },
            auth: {
                system: false
            }
        },

    }
};
