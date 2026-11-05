/* Copyright (C) 2026 NooBaa */
'use strict';

// Native columns table: fields are real column names.
module.exports = [
    {
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
