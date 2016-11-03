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
                        $ref: 'frontend_notifications_api#/definitions/alert_severity'
                    },
                    id: {
                        type: 'integer',
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },
    },
    definitions: {
        alert_severity: {
            enum: ['CRIT', 'MAJOR', 'INFO'],
            type: 'string',
        },
    }
};
