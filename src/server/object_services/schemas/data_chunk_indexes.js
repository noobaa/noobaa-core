/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [{
        fields: {
            dedup_key: 1,
        },
        options: {
            unique: false,
            partialFilterExpression: {
                dedup_key: { $exists: true }
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
            partialFilterExpression: {
                deleted: { $exists: true }
            }
        }
    }
];
