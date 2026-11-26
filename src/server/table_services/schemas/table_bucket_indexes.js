/* Copyright (C) 2026 NooBaa */
'use strict';

// Unique partial index: a table-bucket name is unique per system (design §5), following
// the unique-partial pattern used for buckets and vector indices.
module.exports = [{
    fields: {
        system: 1,
        name: 1,
    },
    options: {
        unique: true,
        partialFilterExpression: {
            deleted: null,
        }
    }
}, ];
