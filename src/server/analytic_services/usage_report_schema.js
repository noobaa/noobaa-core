/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    id: 'usage_report_schema',
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
        // the time of the first sample in the range (the "real" start time)
        first_sample_time: {
            idate: true
        },
        // the time range in ms that this document is aggregated to
        // e.g. aggregated_time_range for 1 hour is 3600000
        aggregated_time_range: {
            type: 'integer',
        },
        aggregated_time: {
            idate: true
        },
        bucket: {
            objectid: true
        },
        account: {
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
    }
};
