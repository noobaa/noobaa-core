/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = [
    {
        // dequeue and size skip rows with dead_at set. This index covers the rest,
        // in the order those messages become claimable. The table is one queue.
        fields: {
            visible_at: 1,
        },
        options: {
            name: 'message_queue_visible_at_index',
            partialFilterExpression: {
                dead_at: null,
            },
        },
    },
];
