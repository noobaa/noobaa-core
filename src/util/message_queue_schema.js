/* Copyright (C) 2016 NooBaa */
'use strict';

module.exports = {
    $id: 'message_queue_schema',
    type: 'object',
    required: [
        '_id',
        'payload',
        'enqueued_at',
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
        // Absent when the row is free.
        // dequeue sets the claim deadline. A requeue with a retry delay sets
        // that delay here and leaves the row in its original _id place.
        locked_until: { date: true },
        // Retries already used. Absent until the first claim, which stores 0.
        // Each later claim adds 1, including a claim past the queue retry limit.
        // retry_count above that limit means the previous claim already used the last try.
        retry_count: { type: 'integer', minimum: 0 },
        // Current claim. ack and nack must present it.
        lock_token: { type: 'string' },
        last_error: { type: 'string' },
        // Set by a dropping nack, and by the cleaner for a claim past the retry limit
        // whose lock has expired. Claims and size skip these rows.
        dead_at: { date: true },
    },
};
