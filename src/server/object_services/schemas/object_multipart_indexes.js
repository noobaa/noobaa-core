/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [
    {
        fields: {
            obj: 1,
            num: 1,
        },
        options: {
            unique: false,
            partialFilterExpression: {
                obj: { $exists: true },
                deleted: null,
            }
        }
    },
    {
        fields: {
            obj: 1,
        },
        options: {
            unique: false,
            partialFilterExpression: {
                obj: { $exists: true },
                deleted: { $exists: true },
            }
        }
    }
];
