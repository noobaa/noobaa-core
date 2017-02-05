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
    },
    definitions: {
    }
};
