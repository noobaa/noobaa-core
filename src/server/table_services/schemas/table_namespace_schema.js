/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * table_namespaces - a dedicated collection served by table_server (design §3.4, §5).
 * A single-level grouping of tables inside a table bucket. Addressed by name; a
 * namespace has no rename operation, which is what makes it safe for a table pointer to
 * reference its namespace by name rather than by id (§5).
 *
 * No $id - see table_bucket_schema for why.
 */
module.exports = {
    type: 'object',
    required: [
        '_id',
        'table_bucket',
        'name',
    ],
    properties: {
        _id: {
            objectid: true,
        },
        // the parent table-bucket id (table_buckets._id)
        table_bucket: {
            objectid: true,
        },
        name: {
            type: 'string',
        },
        // free-form Iceberg namespace properties: a string-to-string map
        properties: {
            type: 'object',
            additionalProperties: {
                type: 'string',
            },
        },
        created_at: {
            idate: true,
        },
        deleted: {
            date: true,
        },
    },
};
