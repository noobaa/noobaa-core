/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'func_stats_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'func_id',
        'start_time',
        'latency_ms',
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        system: {
            format: 'objectid'
        },
        func_id: {
            format: 'objectid'
        },
        start_time: {
            format: 'date'
        },
        latency_ms: {
            type: 'number'
        },
        error: {
            type: 'boolean'
        },
    }
};
