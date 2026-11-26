/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * table_pointers - a dedicated collection served by table_server (design §3.4, §5).
 * The target of the atomic pointer swap (§7). Keyed on
 * {table_bucket, namespace_name, name}, so a table is found in one indexed lookup
 * without resolving its namespace first (§5). The record _id is the opaque table id -
 * the first path segment of the table's location, s3://<backing-bucket>/<table-id> (§3.3).
 *
 * An uninitialized pointer (§6.1.3) carries only a version token: metadata_location,
 * metadata_etag and table_uuid are absent until the first commit's swap stores them.
 *
 * No $id - see table_bucket_schema for why.
 */
module.exports = {
    type: 'object',
    required: [
        '_id',
        'table_bucket',
        'namespace_name',
        'name',
        'version_token',
        'kind',
    ],
    properties: {
        _id: {
            objectid: true, // == the <table-id> path segment of the location (§3.3)
        },
        // the parent table-bucket id (table_buckets._id)
        table_bucket: {
            objectid: true,
        },
        // the namespace name (not id) - safe because namespaces cannot be renamed (§5)
        namespace_name: {
            type: 'string',
        },
        name: {
            type: 'string',
        },
        // s3://<backing-bucket>/<table-id>/metadata/NNNNN-<uuid>.metadata.json;
        // absent while the pointer is uninitialized (§6.1.3)
        metadata_location: {
            type: 'string',
        },
        // ETag of the metadata.json object; passed as If-Match on every catalog read (§3.3)
        metadata_etag: {
            type: 'string',
        },
        // regenerated on every successful commit; the swap predicate (§3.4)
        version_token: {
            type: 'string',
        },
        // Iceberg table-uuid, stable across renames; set by the first commit if uninitialized
        table_uuid: {
            type: 'string',
        },
        // 'table' in this phase - 'view' is reserved and unused (§5)
        kind: {
            type: 'string',
            enum: ['table', 'view'],
        },
        created_at: {
            idate: true,
        },
        deleted: {
            date: true,
        },
    },
};
