/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * DEBUG API
 *
 *
 */
module.exports = {

    $id: 'debug_api',

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

        get_coverage_data: {
            method: 'GET',
            reply: {
                type: 'object',
                properties: {
                    coverage_data: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    },
                },
            },
            auth: {
                system: 'admin'
            }
        },

    }
};
