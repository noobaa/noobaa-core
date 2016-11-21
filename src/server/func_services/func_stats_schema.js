/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'func_stats_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'func',
        'time',
        'took',
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        system: {
            format: 'objectid'
        },
        func: {
            format: 'objectid'
        },
        time: {
            format: 'date'
        },
        took: {
            type: 'number'
        },
        error: {
            type: 'boolean'
        },
    }
};
