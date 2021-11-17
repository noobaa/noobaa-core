/* Copyright (C) 2016 NooBaa */
'use strict';

const SensitiveString = require('../../util/sensitive_string');

module.exports = {
    $id: 'activity_log_schema',
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
            objectid: true
        },
        system: {
            objectid: true
        },
        time: {
            date: true,
        },
        level: {
            type: 'string',
            enum: ['info', 'warning', 'alert'],
        },
        event: {
            type: 'string',
        },
        desc: {
            wrapper: SensitiveString,
        },
        tier: {
            objectid: true
        },
        node: {
            objectid: true
        },
        bucket: {
            objectid: true
        },
        obj: {
            objectid: true
        },
        account: {
            objectid: true
        },
        pool: {
            objectid: true
        },
        func: {
            objectid: true
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
            objectid: true
        }
    }
};
