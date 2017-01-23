/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'activity_log_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'time',
        'level',
        'event'
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        system: {
            format: 'objectid'
        },
        time: {
            format: 'date',
        },
        level: {
            type: 'string',
            enum: ['info', 'warning', 'alert'],
        },
        event: {
            type: 'string',
        },
        desc: {
            type: 'string',
        },
        tier: {
            format: 'objectid'
        },
        node: {
            format: 'objectid'
        },
        bucket: {
            format: 'objectid'
        },
        obj: {
            format: 'objectid'
        },
        account: {
            format: 'objectid'
        },
        pool: {
            format: 'objectid'
        },
        server: {
            type: 'object',
            properties: {
                secret: {
                    type: 'string'
                },
                hostname: {
                    type: 'string'
                }
            }
        },
        // The User that performed the action
        actor: {
            format: 'objectid'
        }
    }
};
