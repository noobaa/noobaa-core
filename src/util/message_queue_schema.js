/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'message_queue_schema',
    type: 'object',
    required: [
        '_id',
        'payload',
        'enqueued_at',
        'visible_at',
    ],
    properties: {
        _id: { objectid: true },
        // JSON object passed to enqueue. Shape belongs to the worker.
        payload: {
            type: 'object',
            properties: {},
            additionalProperties: true,
        },
        enqueued_at: { date: true },
        // Not claimable before this time. nack pushes it forward.
        visible_at: { date: true },
        // Claim deadline set by dequeue. Absent when the row is free.
        locked_until: { date: true },
        // Retries already used. Absent until the first claim, which stores 0.
        // Each later claim adds 1, including a claim past the queue retry limit.
        // retry_count above that limit means the previous claim already used the last try.
        retry_count: { type: 'integer', minimum: 0 },
        // Current claim. ack and nack must present it.
        lock_token: { type: 'string' },
        last_error: { type: 'string' },
        // Set by a dropping nack. The live index omits these rows.
        dead_at: { date: true },
    },
};
