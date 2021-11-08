/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'io_stats_schema',
    type: 'object',
    required: [
        '_id',
        'system',
        'start_time',
        'end_time',
        'resource_id',
        'resource_type'
    ],
    properties: {
        _id: {
            objectid: true
        },
        system: {
            objectid: true
        },
        start_time: {
            idate: true
        },
        end_time: {
            idate: true
        },
        resource_type: {
            type: 'string',
            enum: ['NODE', 'NAMESPACE_RESOURCE']
        },
        resource_id: {
            objectid: true
        },
        read_bytes: {
            type: 'integer',
        },
        write_bytes: {
            type: 'integer',
        },
        read_count: {
            type: 'integer',
        },
        write_count: {
            type: 'integer',
        },
        error_read_bytes: {
            type: 'integer',
        },
        error_write_bytes: {
            type: 'integer',
        },
        error_read_count: {
            type: 'integer',
        },
        error_write_count: {
            type: 'integer',
        },
    }
};
