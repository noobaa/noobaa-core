/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [{
    fields: {
        email: 1,
    },
    options: {
        unique: true,
        partialFilterExpression: {
            deleted: null,
        }
    }
}, ];
