/* Copyright (C) 2016 NooBaa */
'use strict';

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
