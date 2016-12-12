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
                type: 'object',
                required: ['severity', 'id'],
                properties: {
                    severity: {
                        $ref: 'events_api#/definitions/alert_severity_enum'
                    },
                    id: {
                        type: 'integer',
                    }
                }
            },
            auth: {
                system: false
            }
        },

        notify_on_system_store: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    event: {
                        enum: ['CONNECT', 'DISCONNECT', 'CHANGE'],
                        type: 'string',
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
