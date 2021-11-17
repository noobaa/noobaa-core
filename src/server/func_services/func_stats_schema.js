/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'func_stats_schema',
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
            objectid: true
        },
        system: {
            objectid: true
        },
        func: {
            objectid: true
        },
        time: {
            date: true
        },
        took: {
            type: 'number'
        },
        error: {
            type: 'boolean'
        },
        error_msg: {
            type: 'string'
        },
    }
};
