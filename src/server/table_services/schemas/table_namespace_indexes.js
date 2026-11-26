/* Copyright (C) 2026 NooBaa */
'use strict';

// Unique partial index: a namespace name is unique per table bucket (design §5). The
// table_bucket id is already globally unique, so system is not part of the key.
module.exports = [{
    fields: {
        table_bucket: 1,
        name: 1,
    },
    options: {
        unique: true,
        partialFilterExpression: {
            deleted: null,
        }
    }
}, ];
