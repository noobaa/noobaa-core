/* Copyright (C) 2026 NooBaa */
'use strict';

// Native columns table: fields are real column names.
module.exports = [
    {
        // required by INSERT ... ON CONFLICT (scope_type, scope_id, shard) in QuotaStore
        fields: {
            scope_type: 1,
            scope_id: 1,
            shard: 1,
        },
        options: {
            name: 'scope_type_scope_id_shard_unique',
            unique: true,
        }
    }
];
