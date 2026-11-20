/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [{
        postgres: true,
        fields: {
            _id: -1,
        },
        options: {
            // iterate_all_chunks
            name: 'id_desc',
            partialFilterExpression: {
                deleted: null,
            }
        }
    },
    {
        fields: {
            dedup_key: 1,
            system: 1,
            bucket: 1
        },
        options: {
            unique: false,
            partialFilterExpression: {
                dedup_key: { $exists: true }
            }
        }
    },
    {
        fields: {
            tier: 1,
            tier_lru: -1,
        },
        options: {
            name: 'tiering_index',
            unique: false,
            partialFilterExpression: {
                deleted: null,
                tier: { $exists: true },
                tier_lru: { $exists: true },
            }
        }
    },
    {
        // aggregate_chunks_by_delete_dates()
        fields: {
            deleted: 1,
        },
        options: {
            unique: false,
            name: "aggregate_by_delete_dates",
            partialFilterExpression: {
                deleted: { $exists: true }
            }
        }
    },
    {
        // index for range scan on pending_delete
        fields: {
            pending_delete: 1,
        },
        options: {
            bigint: true,
            unique: false,
            name: "pending_deleted_all",
        }
    },
    {
        // phase B block update: data->>'deleted' = <timestamp>
        fields: {
            deleted: 1,
        },
        options: {
            unique: false,
            name: 'deleted',
        }
    }
];
