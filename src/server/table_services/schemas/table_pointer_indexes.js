/* Copyright (C) 2026 NooBaa */
'use strict';

// Unique partial index on {table_bucket, namespace_name, name} (design §5). It finds a
// table in one indexed lookup and makes concurrent CreateTable / RenameTable resolve to
// one winner through a duplicate-key error - the same technique object_server uses for
// racing conditional writes.
module.exports = [{
    fields: {
        table_bucket: 1,
        namespace_name: 1,
        name: 1,
    },
    options: {
        unique: true,
        partialFilterExpression: {
            deleted: null,
        }
    }
}, ];
