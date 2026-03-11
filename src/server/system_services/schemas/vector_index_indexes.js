/* Copyright (C) 2026 NooBaa */
'use strict';

module.exports = [{
    fields: {
        system: 1,
        vector_bucket: 1,
        name: 1,
    },
    options: {
        unique: true,
        partialFilterExpression: {
            deleted: null,
        }
    }
}, ];
