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

    mocha.it('postgres queue leaves an abandoned claim for the cleaner', async function() {
        const name = `abandon_${Date.now().toString(36)}`;
        const orig_registered = config.MESSAGE_QUEUE_REGISTERED;
        config.MESSAGE_QUEUE_REGISTERED = Object.freeze([name]);
        try {
            await postgres_queue.connect(name, { visibility_ms: 60000, retry_limit: 0 });
            const abandoned_id = await postgres_queue.enqueue(name, { kind: 'deleted', object_ids: ['abandoned'] });
            const live_id = await postgres_queue.enqueue(name, { kind: 'deleted', object_ids: ['live'] });

            const first = await postgres_queue.dequeue(name);
            assert.ok(first);
            assert.strictEqual(first._id, abandoned_id);
            assert.strictEqual(first.retry_count, 0);
            await expire_lock(name, abandoned_id);

            const exceeded = await postgres_queue.dequeue(name);
            assert.ok(exceeded);
            assert.strictEqual(exceeded._id, abandoned_id);
            assert.strictEqual(exceeded.retry_count, 1);
            assert.strictEqual(postgres_queue.is_retry_limit_exceeded(exceeded), true);

            await postgres_queue.dead_letter_abandoned_messages(100);
            const held = await dead_row(name, abandoned_id);
            assert.strictEqual(held.dead, false);

            await expire_lock(name, abandoned_id);
            const next = await postgres_queue.dequeue(name);
            assert.ok(next);
            assert.strictEqual(next._id, live_id);
            await postgres_queue.ack(next);
            const skipped = await dead_row(name, abandoned_id);
            assert.strictEqual(skipped.dead, false);

            const { removed } = await postgres_queue.dead_letter_abandoned_messages(100);
            assert.ok(removed >= 1);
            const row = await dead_row(name, abandoned_id);
            assert.strictEqual(row.dead, true);
            assert.strictEqual(row.last_error, 'visibility timeout');
        } finally {
            config.MESSAGE_QUEUE_REGISTERED = orig_registered;
        }
    });

    mocha.it('postgres queue holds a nacked message and then claims the next _id', async function() {
        const name = `order_${Date.now().toString(36)}`;
        await postgres_queue.connect(name, { retry_delay_ms: 60000 });
        const older_id = await postgres_queue.enqueue(name, { kind: 'deleted', object_ids: ['older'] });
        const newer_id = await postgres_queue.enqueue(name, { kind: 'deleted', object_ids: ['newer'] });

        const claimed = await postgres_queue.dequeue(name);
        assert.ok(claimed);
        assert.strictEqual(claimed._id, older_id);
        const requeued = await postgres_queue.nack(claimed, 'retry');
        assert.strictEqual(requeued.dropped, false);

        const next = await postgres_queue.dequeue(name);
        assert.ok(next);
        assert.strictEqual(next._id, newer_id);
        await postgres_queue.ack(next);
        assert.strictEqual(await postgres_queue.dequeue(name), null);
    });

    mocha.it('postgres queue removes only dead messages older than retention', async function() {
        const queue_name = `dead_clean_${Date.now().toString(36)}`;
        const retention_ms = 60 * 60 * 1000;
        const orig_registered = config.MESSAGE_QUEUE_REGISTERED;
        config.MESSAGE_QUEUE_REGISTERED = Object.freeze([queue_name]);
        try {
            await postgres_queue.connect(queue_name, { retry_limit: 0, dead_retention_ms: retention_ms });

            const recent_dead_id = await enqueue_dead_message(postgres_queue, queue_name, 'recent');
            const expired_dead_id = await enqueue_dead_message(postgres_queue, queue_name, 'expired');
            await set_dead_at(queue_name, expired_dead_id, retention_ms + 1000);
            const live_id = await postgres_queue.enqueue(queue_name, { kind: 'deleted', object_ids: ['live'] });

            const { removed } = await postgres_queue.remove_expired_dead_messages(100);
            assert.ok(removed >= 1);

            const left = await db_client.instance().executeSQL(
                `SELECT _id, data->'dead_at' IS NOT NULL AS dead FROM ${queue_name}`,
            );
            const dead_by_id = new Map(left.rows.map(row => [String(row._id).trim(), row.dead]));
            assert.strictEqual(dead_by_id.size, 2);
            assert.strictEqual(dead_by_id.get(live_id), false);
            assert.strictEqual(dead_by_id.get(recent_dead_id), true);
            assert.strictEqual(dead_by_id.has(expired_dead_id), false);
        } finally {
            config.MESSAGE_QUEUE_REGISTERED = orig_registered;
        }
    });

    mocha.it('postgres queue keeps only the newest dead messages', async function() {
        const queue_name = `dead_cap_${Date.now().toString(36)}`;
        const orig_max_dead = config.MESSAGE_QUEUE_MAX_DEAD;
        const orig_registered = config.MESSAGE_QUEUE_REGISTERED;
        config.MESSAGE_QUEUE_MAX_DEAD = 2;
        config.MESSAGE_QUEUE_REGISTERED = Object.freeze([queue_name]);
        try {
            await postgres_queue.connect(queue_name, { retry_limit: 0 });
            const first_id = await enqueue_dead_message(postgres_queue, queue_name, 'first');
            const second_id = await enqueue_dead_message(postgres_queue, queue_name, 'second');
            const third_id = await enqueue_dead_message(postgres_queue, queue_name, 'third');
            await enqueue_dead_message(postgres_queue, queue_name, 'fourth');
            await postgres_queue.remove_expired_dead_messages(100);

            const left = await db_client.instance().executeSQL(
                `SELECT _id FROM ${queue_name} WHERE data->'dead_at' IS NOT NULL`,
            );
            const ids = left.rows.map(row => String(row._id).trim());
            assert.strictEqual(ids.length, 2);
            assert.strictEqual(ids.includes(first_id), false);
            assert.strictEqual(ids.includes(second_id), false);
            assert.strictEqual(ids.includes(third_id), true);
        } finally {
            config.MESSAGE_QUEUE_MAX_DEAD = orig_max_dead;
            config.MESSAGE_QUEUE_REGISTERED = orig_registered;
        }
    });

    mocha.it('postgres one producer and one consumer drain one queue together', async function() {
        await exercise_one_producer_one_consumer(postgres_queue, 'pg');
    });

    mocha.it('postgres many producers and many consumers claim each message once', async function() {
        await exercise_many_producers_many_consumers(postgres_queue, 'pg');
    });
});

/**
 * Enqueue one message and drop it on the first nack.
 * The queue must have no other live message, because dequeue claims the smallest _id.
 * @param {PostgresMessageQueue} queue
 * @param {string} name
 * @param {string} object_id
 * @returns {Promise<string>}
 */
async function enqueue_dead_message(queue, name, object_id) {
    const enqueued_id = await queue.enqueue(name, { kind: 'deleted', object_ids: [object_id] });
    const message = await queue.dequeue(name);
    assert.ok(message);
    assert.strictEqual(message._id, enqueued_id);
    const dropped = await queue.nack(message, 'dropped in test');
    assert.strictEqual(dropped.dropped, true);
    return enqueued_id;
}

/**
 * Set dead_at to age_ms before now. Cleanup deletes a dead row when this age exceeds the queue retention.
 * @param {string} name
 * @param {string} id
 * @param {number} age_ms
 * @returns {Promise<void>}
 */
async function set_dead_at(name, id, age_ms) {
    await db_client.instance().executeSQL(
        `UPDATE ${name}
         SET data = jsonb_set(
             data,
             '{dead_at}',
             to_jsonb(now() - ($2::text || ' milliseconds')::interval)
         )
         WHERE _id = $1`,
        [id, String(age_ms)],
    );
}

/**
 * Move locked_until into the past so the next claim can take the row.
 * @param {string} name
 * @param {string} id
 * @returns {Promise<void>}
 */
async function expire_lock(name, id) {
    await db_client.instance().executeSQL(
        `UPDATE ${name}
         SET data = jsonb_set(data, '{locked_until}', to_jsonb(now() - interval '1 millisecond'))
         WHERE _id = $1`,
        [id],
    );
}

/**
 * @param {string} name
 * @param {string} id
 * @returns {Promise<{ dead: boolean, last_error: string }>}
 */
async function dead_row(name, id) {
    const res = await db_client.instance().executeSQL(
        `SELECT data->>'last_error' AS last_error,
                data->'dead_at' IS NOT NULL AS dead
         FROM ${name} WHERE _id = $1`,
        [id],
    );
    return res.rows[0];
}
