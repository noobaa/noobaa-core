/* Copyright (C) 2016 NooBaa */
'use strict';

const coretest = require('../../utils/coretest/coretest');
coretest.setup();

const mocha = require('mocha');
const assert = require('assert');

const config = require('../../../../config');
const db_client = require('../../../util/db_client');
const message_queue_client = require('../../../util/message_queue_client');
const { PostgresMessageQueue } = require('../../../util/postgres_message_queue');
const {
    exercise_queue,
    exercise_stale_ack,
    exercise_exhausted_claim,
    exercise_max_size,
    exercise_one_producer_one_consumer,
    exercise_many_producers_many_consumers,
} = require('./message_queue_exercises');

mocha.describe('message queue', function() {
    this.timeout(120000); // eslint-disable-line no-invalid-this

    /** @type {PostgresMessageQueue} */
    let postgres_queue;

    mocha.before(async function() {
        postgres_queue = new PostgresMessageQueue();
    });

    mocha.it('factory none does not create a queue', function() {
        const orig = config.MESSAGE_QUEUE_TYPE;
        config.MESSAGE_QUEUE_TYPE = 'none';
        try {
            assert.strictEqual(message_queue_client.instance(), undefined);
        } finally {
            config.MESSAGE_QUEUE_TYPE = orig;
        }
    });

    mocha.it('factory rejects an unknown backend', function() {
        const orig = config.MESSAGE_QUEUE_TYPE;
        // @ts-expect-error unknown backend must be rejected at runtime
        config.MESSAGE_QUEUE_TYPE = 'redis';
        try {
            assert.throws(() => message_queue_client.instance(), /NON SUPPORTED MESSAGE_QUEUE_TYPE/);
        } finally {
            config.MESSAGE_QUEUE_TYPE = orig;
        }
    });

    mocha.it('postgres queue locks, retries, and drops JSON batches', async function() {
        await exercise_queue(postgres_queue, 'pg');
    });

    mocha.it('postgres queue ignores a stale ack after the lock expires', async function() {
        await exercise_stale_ack(postgres_queue);
    });

    mocha.it('postgres queue rejects enqueue when the queue is full', async function() {
        const orig_capacity = config.MESSAGE_QUEUE_DEFAULT_CAPACITY;
        config.MESSAGE_QUEUE_DEFAULT_CAPACITY = 1;
        try {
            await exercise_max_size(postgres_queue);
        } finally {
            config.MESSAGE_QUEUE_DEFAULT_CAPACITY = orig_capacity;
        }
    });

    mocha.it('postgres queue dead-letters a crashed attempt that used the last try', async function() {
        const { _id, queue } = await exercise_exhausted_claim(postgres_queue);
        const res = await db_client.instance().executeSQL(
            `SELECT data->>'last_error' AS last_error,
                    data->'dead_at' IS NOT NULL AS dead
             FROM ${queue} WHERE _id = $1`,
            [_id],
        );
        assert.strictEqual(res.rows[0].dead, true);
        assert.strictEqual(res.rows[0].last_error, 'visibility timeout');
    });

    mocha.it('postgres one producer and one consumer drain one queue together', async function() {
        await exercise_one_producer_one_consumer(postgres_queue, 'pg');
    });

    mocha.it('postgres many producers and many consumers claim each message once', async function() {
        await exercise_many_producers_many_consumers(postgres_queue, 'pg');
    });
});
