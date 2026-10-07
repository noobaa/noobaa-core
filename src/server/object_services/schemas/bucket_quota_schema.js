/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * Per-bucket live usage row used by strict quota enforcement.
 * Intentionally tiny: the hot path is a single-row UPDATE with a WHERE cap.
 */
module.exports = {
    $id: 'bucket_quota_schema',
    type: 'object',
    required: ['_id', 'owner_id', 'shard', 'used_bytes', 'used_objects'],
    properties: {
        _id: {
            objectid: true // bucket id
        },
        owner_id: {
            objectid: true
        },
        shard: {
            type: 'integer'
        },
        used_bytes: {
            type: 'integer'
        },
        used_objects: {
            type: 'integer'
        },
    }
};
