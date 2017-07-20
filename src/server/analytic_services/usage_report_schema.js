/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'usage_report_schema',
    type: 'object',
    required: ['_id', 'system', 'start_time', 'end_time'],
    properties: {
        _id: {
            format: 'objectid'
        },
        system: {
            format: 'objectid'
        },
        // start time of the aggregated report rounded to the aggregated_time_range
        start_time: {
            format: 'idate'
        },
        end_time: {
            format: 'idate'
        },
        // the time of the first sample in the range (the "real" start time)
        first_sample_time: {
            format: 'idate'
        },
        // the time range in ms that this document is aggregated to
        // e.g. aggregated_time_range for 1 hour is 3600000
        aggregated_time_range: {
            type: 'integer',
        },
        aggregated_time: {
            format: 'idate'
        },
        bucket: {
            format: 'objectid'
        },
        account: {
            format: 'objectid'
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
    }
};
