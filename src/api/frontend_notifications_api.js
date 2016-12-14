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
        emit_event: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['event'],
                properties: {
                    event: {
                        enum: ['ALERT', 'CONNECT', 'DISCONNECT', 'CHANGE'],
                        type: 'string',
                    },
                    args: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    },
                }
            },
            auth: {
                system: false
            }
        },

    },
    definitions: {}
};
