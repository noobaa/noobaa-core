/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [{
        fields: {
            dedup_key: 1,
        },
        options: {
            unique: false,
            sparse: true,
        }
    },
    {
        fields: {
            deleted: 1,
        },
        options: {
            unique: false,
            sparse: true,
        }
    }
];
