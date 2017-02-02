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
    },
    definitions: {
    }
};
