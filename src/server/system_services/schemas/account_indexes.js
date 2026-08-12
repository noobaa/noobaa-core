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
    // ensure unique role name per owner for role identities stored in accounts
    fields: {
        owner: 1,
        name: 1,
    },
    options: {
        unique: true,
        partialFilterExpression: {
            deleted: null,
            identity_type: 'ROLE',
        }
    }
}, ];
