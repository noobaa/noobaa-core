/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [
    // There are many other fields in the table but this is a common denominator
    // and the hot query uses only these fields.
    {
        fields: {
            start_time: 1,
            end_time: 1,
            bucket: 1,
        },
        options: {
            unique: false,
        }
    }
];
