/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [{
    fields: {
        name: 1,
    },
    options: {
        unique: true,
        partialFilterExpression: {
            deleted: null,
        }
    }
}, ];
