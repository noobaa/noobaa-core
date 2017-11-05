/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'alerts_log_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'time',
        'severity',
        'alert',
        'read'
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
        severity: {
            type: 'string',
            enum: ['CRIT', 'MAJOR', 'INFO'],
        },
        alert: {
            type: 'string',
        },
        read: {
            type: 'boolean',
        }
    }
};
