/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * table_buckets - a dedicated collection served by table_server in the endpoint
 * (design §3.4, §5). The parent of namespaces and tables, kept outside the in-memory
 * system_store so it can be locked in the same PostgreSQL transaction as its children
 * (story 6b). The record _id is the opaque table-bucket id carried in the ARN (§3.5).
 *
 * No $id is set on purpose: define_collection() registers the schema under the
 * collection name, so leaving $id out lets a suffixed test collection reuse the same
 * schema object without an ajv id clash.
 */
module.exports = {
    type: 'object',
    required: [
        '_id',
        'system',
        'name',
        'owner',
        'backing_bucket_name',
        'state',
    ],
    properties: {
        _id: {
            objectid: true, // == the table-bucket id (the <bucket> ARN segment, §3.5)
        },
        system: {
            objectid: true,
        },
        name: {
            type: 'string',
        },
        owner: {
            objectid: true, // the owning account id
        },
        // derived backing-bucket name <name>--table-s3-nb (§3.2); stamped at creation
        backing_bucket_name: {
            type: 'string',
        },
        // the backing bucket's system_store id, once core has provisioned it (story 4)
        backing_bucket: {
            objectid: true,
        },
        // lifecycle state (§6.1.3). Only `ready` is visible to clients; story 6b adds the
        // conditional transitions and the ready-only read rule.
        state: {
            type: 'string',
            enum: ['provisioning', 'ready', 'aborting', 'deleting'],
        },
        // the table bucket's encryption setting; tables inherit it (§10). The catalog only
        // ever stores AES256 - aws:kms and SSE-C are rejected by the SDK before they reach
        // the store (story 10), so the stored form is AES256-only.
        encryption: {
            type: 'object',
            required: ['sse_algorithm'],
            properties: {
                sse_algorithm: {
                    type: 'string',
                    enum: ['AES256'],
                },
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
