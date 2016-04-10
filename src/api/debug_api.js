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
        get_istanbul_collector: {
            method: 'GET',
            reply: {
                type: 'object',
                required: ['data'],
                properties: {
                    data: {                        
                        type: 'string',
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },
    }
};
