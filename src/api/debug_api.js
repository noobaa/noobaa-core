'use strict';

/**
 *
 * DEBUG API
 *
 *
 */
module.exports = {

    id: 'debug_api',

    methods: {
        set_debug_level: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['module', 'level'],
                properties: {
                    module: {
                        type: 'string',
                    },
                    level: {
                        type: 'integer',
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },
    }
};
