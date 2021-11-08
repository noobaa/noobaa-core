/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'usage_report_schema',
    type: 'object',
    required: ['_id', 'system', 'start_time', 'end_time'],
    properties: {
        _id: {
            objectid: true
        },
        system: {
            objectid: true
        },
        // start time of the aggregated report rounded to the aggregated_time_range
        start_time: {
            idate: true
        },
        end_time: {
            idate: true
        },
        bucket: {
            objectid: true
        },
        account: {
            objectid: true
        },
        endpoint_group: {
            type: 'string'
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
        }
    }
};
