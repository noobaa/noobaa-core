/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * Per-bucket live usage row used by strict quota enforcement.
 * Intentionally tiny: the hot path is a single-row UPDATE with a WHERE cap.
 */
module.exports = {
    $id: 'quota_usage_schema',
    type: 'object',
    required: ['scope_type', 'scope_id', 'shard', 'used_bytes', 'used_objects'],
    properties: {
        /*_id: {
            objectid: true
        },*/
        // scope_id is the bucket/scope identifier this shard belongs to
        scope_id: {
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
        scope_type: {
            type: 'string'
        }
    }
};
