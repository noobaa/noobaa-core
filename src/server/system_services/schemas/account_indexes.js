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
    // unique role name per owner when type === 'role' (roles stored as accounts)
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
