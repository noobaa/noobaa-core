/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'bucket_stats_schema',
    type: 'object',
    required: ['_id', 'system', 'bucket', 'content_type'],
    properties: {
        _id: {
            objectid: true
        },
        system: {
            objectid: true
        },
        bucket: {
            objectid: true
        },
        content_type: {
            type: 'string'
        },
        reads: {
            type: 'integer',
        },
        writes: {
            type: 'integer',
        },
        last_read: {
            idate: true
        },
        last_write: {
            idate: true
        },
    }
};
