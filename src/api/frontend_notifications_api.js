/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * FE NOTIFICATIONS API
 *
 *
 */
module.exports = {

    id: 'frontend_notifications_api',

    methods: {
        alert: {
            method: 'POST',
            params: {
                $ref: 'events_api#/definitions/alert_query'
            },
            auth: {
                system: false
            }
        },

        add_memeber_to_cluster: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['secret', 'result'],
                properties: {
                    secret: {
                        type: 'string'
                    },
                    result: {
                        type: 'boolean'
                    },
                    reason: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: false
            }
        },
    },
    definitions: {}
};
