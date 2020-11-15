/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [{
    fields: {
        system: 1,
        name: 1,
        version: 1,
        deleted: 1, // allow to filter deleted
    },
    options: {
        unique: true,
    }
}, ];
