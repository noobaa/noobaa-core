/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [{
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
            unique: false,
            sparse: true,
        }
    },
    {
        fields: {
            chunk: 1,
        },
        options: {
            unique: false,
            sparse: true,
        }
    },
];
