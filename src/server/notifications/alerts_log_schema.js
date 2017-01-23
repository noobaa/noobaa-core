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
            format: 'objectid'
        },
        system: {
            format: 'objectid'
        },
        time: {
            format: 'date',
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
