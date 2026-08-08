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
}, {
    // Unique role name per owner when type === 'role' (roles stored in accounts).
    fields: {
        owner: 1,
        name: 1,
    },
    options: {
        unique: true,
        partialFilterExpression: {
            deleted: null,
            type: 'role',
        }
    }
}, ];
