'use strict';

/**
 *
 * BG_WORKERS API
 *
 *
 */
module.exports = {

    name: 'bg_workers_api',

    methods: {
        set_debug_level: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['level'],
                properties: {
                    level: {
                        type: 'integer',
                    },
                    module: {
                        type: 'string',
                    },
                }
            },
            auth: {
                system: 'admin'
            }
        },
    }
};
