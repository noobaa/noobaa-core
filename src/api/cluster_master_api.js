/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * CLUSTER MASTER API
 *
 */
module.exports = {

    id: 'cluster_master_api',

    methods: {

        set_master_updates: {
            method: 'PUT',
            params: {
                type: 'object',
                required: ['enabled'],
                properties: {
                    enabled: {
                        type: 'boolean',
                    },
                }
            },
            auth: { system: 'admin' }
        },
    },

    definitions: {

    }
};
