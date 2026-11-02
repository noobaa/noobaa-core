/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [
    {
        // dequeue and size skip rows with dead_at set. This index is the rest,
        // in claim order. _id grows with enqueue time, and the table is one queue.
        fields: {
            _id: 1,
        },
        options: {
            name: 'message_queue_live_index',
            partialFilterExpression: {
                dead_at: null,
            },
        },
    },
];
