/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [
    {
        fields: {
            // this index is used for index prefix for queries on the object without start offset
            obj: 1,
            // we index only the start offset and not the end to save index size
            // and use the start with both $lt and $gt when searching for ranges
            // in order to use the index efficiently and only scan the docs
            // that are indeed in the range.
            start: 1,
        },
        options: {
            name: 'obj_1_start_1',
            unique: false,
            partialFilterExpression: {
                obj: { $exists: true },
                deleted: null,
            }
        }
    },
    {
        fields: {
            chunk: 1,
        },
        options: {
            unique: false,
            partialFilterExpression: {
                chunk: { $exists: true },
            }
        }
    },
    {
        // This index is used for queries where we want to find all the chunks of a specific object
        // which are already marked deleted.
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
