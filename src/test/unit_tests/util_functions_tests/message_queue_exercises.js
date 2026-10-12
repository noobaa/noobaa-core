/* Copyright (C) 2016 NooBaa */
/** @typedef {typeof import('../../../sdk/nb')} nb */
'use strict';

const assert = require('assert');

const P = require('../../../util/promise');
const config = require('../../../../config');

/**
 * @param {nb.MessageQueueClient} queue
 * @param {string} prefix
 */
async function exercise_queue(queue, prefix) {
    const name = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await queue.connect(name);
    assert.strictEqual(await queue.size(name), 0);
    assert.strictEqual(await queue.dequeue(name), null);
    await assert.rejects(() => queue.enqueue(name, /** @type {any} */ (null)), /JSON object/);

    const enqueued_id = await queue.enqueue(name, {
        kind: 'deleted',
        object_ids: ['obj-1', 'obj-2'],
    });
    assert.ok(enqueued_id);
    await queue.enqueue(name, { kind: 'expired_restore', object_ids: ['obj-3'] });
    assert.strictEqual(await queue.size(name), 2);

    const first = await queue.dequeue(name);
    const second = await queue.dequeue(name);
    assert.ok(first && second);
    assert.notStrictEqual(first._id, second._id);
    assert.strictEqual(await queue.dequeue(name), null);
    const first_ids = /** @type {{ object_ids: string[] }} */ (first.payload).object_ids;
    const second_ids = /** @type {{ object_ids: string[] }} */ (second.payload).object_ids;
    const ids = first_ids.concat(second_ids);
    assert.deepStrictEqual(ids.sort(), ['obj-1', 'obj-2', 'obj-3']);
    assert.strictEqual(first.retry_count, 0);
    assert.strictEqual(second.retry_count, 0);

    await queue.ack(first);

    const orig_delay = config.MESSAGE_QUEUE_DEFAULT_RETRY_DELAY_MS;
    config.MESSAGE_QUEUE_DEFAULT_RETRY_DELAY_MS = 0;
    try {
        const retried = await queue.nack(second, 'try again');
        assert.strictEqual(retried.dropped, false);
        const again = await queue.dequeue(name);
        assert.ok(again);
        assert.strictEqual(again._id, second._id);
        assert.strictEqual(again.retry_count, 1);
        assert.deepStrictEqual(again.payload, second.payload);
        await queue.ack(again);
        assert.strictEqual(await queue.size(name), 0);

        const drop_name = `${name}_drop`;
        await queue.connect(drop_name, undefined, 0);
        await queue.enqueue(drop_name, { kind: 'transition_source', object_ids: ['obj-9'] });
        const doomed = await queue.dequeue(drop_name);
        if (!doomed) throw new Error('expected a message to drop');
        assert.strictEqual(doomed.retry_count, 0);
        const dropped = await queue.nack(doomed, 'give up');
        assert.strictEqual(dropped.dropped, true);
        assert.strictEqual(await queue.dequeue(drop_name), null);
        assert.strictEqual(await queue.size(drop_name), 0);
    } finally {
        config.MESSAGE_QUEUE_DEFAULT_RETRY_DELAY_MS = orig_delay;
    }
}

/**
 * @param {nb.MessageQueueClient} queue
 */
async function exercise_stale_ack(queue) {
    const name = `pg_stale_${Date.now().toString(36)}`;
    await queue.connect(name, '1');
    await queue.enqueue(name, { kind: 'deleted', object_ids: ['obj-s'] });
    const first = await queue.dequeue(name);
    if (!first) throw new Error('expected a message');
    await P.delay(50);
    const second = await queue.dequeue(name);
    if (!second) throw new Error('expected the message to be claimed again');
    assert.strictEqual(second._id, first._id);
    assert.strictEqual(second.retry_count, 1);
    assert.notStrictEqual(second.lock_token, first.lock_token);
    await assert.rejects(() => queue.ack(first), /could not delete message/);
    assert.strictEqual(await queue.size(name), 1);
    await queue.ack(second);
    assert.strictEqual(await queue.size(name), 0);
}

/**
 * The claim after the last allowed try has retry_count one past the queue limit.
 * nack drops it instead of running the batch again.
 * The first claim stores 0, so a limit of 0 still runs once.
 * @param {nb.MessageQueueClient} queue
 * @returns {Promise<{ _id: string, queue: string }>}
 */
async function exercise_exhausted_claim(queue) {
    const name = `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await queue.connect(name, '1', 0);
    await queue.enqueue(name, { kind: 'deleted', object_ids: ['obj-dead'] });
    await queue.enqueue(name, { kind: 'deleted', object_ids: ['obj-live'] });
    const crashed = await queue.dequeue(name);
    if (!crashed) throw new Error('expected a message');
    assert.strictEqual(crashed.retry_count, 0);
    assert.strictEqual(queue.is_exhausted_claim(crashed), false);
    await P.delay(50);
    const expired = await queue.dequeue(name);
    if (!expired) throw new Error('expected the exhausted message to be returned');
    assert.strictEqual(expired._id, crashed._id);
    assert.strictEqual(expired.retry_count, 1);
    assert.strictEqual(queue.is_exhausted_claim(expired), true);
    const dropped = await queue.nack(expired, 'visibility timeout');
    assert.strictEqual(dropped.dropped, true);
    const live = await queue.dequeue(name);
    if (!live) throw new Error('expected the next live message');
    assert.notStrictEqual(live._id, crashed._id);
    assert.strictEqual(live.retry_count, 0);
    assert.strictEqual(queue.is_exhausted_claim(live), false);
    const crashed_ids = /** @type {{ object_ids: string[] }} */ (crashed.payload).object_ids;
    const live_ids = /** @type {{ object_ids: string[] }} */ (live.payload).object_ids;
    assert.deepStrictEqual(crashed_ids.concat(live_ids).sort(), ['obj-dead', 'obj-live']);
    await queue.ack(live);
    assert.strictEqual(await queue.dequeue(name), null);
    assert.strictEqual(await queue.size(name), 0);
    return { _id: crashed._id, queue: name };
}

/**
 * The capacity counts messages still in the queue, including one a caller is working on.
 * A dropped message has dead_at set and does not consume a slot.
 * @param {nb.MessageQueueClient} queue
 */
async function exercise_max_size(queue) {
    const name = `max_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await queue.connect(name, undefined, 0);
    await queue.enqueue(name, { kind: 'deleted', object_ids: ['obj-full'] });
    await assert.rejects(
        () => queue.enqueue(name, { kind: 'deleted', object_ids: ['obj-extra'] }),
        /is full/,
    );
    const held = await queue.dequeue(name);
    if (!held) throw new Error('expected a message');
    await assert.rejects(
        () => queue.enqueue(name, { kind: 'deleted', object_ids: ['obj-held'] }),
        /is full/,
    );
    const dropped = await queue.nack(held, 'give up');
    assert.strictEqual(dropped.dropped, true);
    assert.strictEqual(await queue.size(name), 0);
    await queue.enqueue(name, { kind: 'deleted', object_ids: ['obj-next'] });
    assert.strictEqual(await queue.size(name), 1);
    const next = await queue.dequeue(name);
    if (!next) throw new Error('expected the message after the drop');
    await queue.ack(next);
    assert.strictEqual(await queue.size(name), 0);
}

/**
 * One producer task and one consumer task run at the same time.
 * The consumer keeps polling until the producer has finished and every
 * message has been acked once.
 * @param {nb.MessageQueueClient} queue
 * @param {string} prefix
 */
async function exercise_one_producer_one_consumer(queue, prefix) {
    await exercise_concurrent_workers(queue, prefix, 1, 1, 40);
}

/**
 * Several producers insert while several consumers claim. Each message id
 * is acked once.
 * @param {nb.MessageQueueClient} queue
 * @param {string} prefix
 */
async function exercise_many_producers_many_consumers(queue, prefix) {
    await exercise_concurrent_workers(queue, prefix, 4, 8, 8);
}

/**
 * @param {nb.MessageQueueClient} queue
 * @param {string} prefix
 * @param {number} producers
 * @param {number} consumers
 * @param {number} per_producer
 */
async function exercise_concurrent_workers(queue, prefix, producers, consumers, per_producer) {
    const name = `${prefix}_conc_${producers}p${consumers}c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await queue.connect(name);
    const count = producers * per_producer;
    /** @type {Set<string>} */
    const claimed = new Set();
    /** @type {Set<number>} */
    const payloads = new Set();
    let enqueued = 0;
    let producers_done = 0;

    await Promise.all([
        ...Array.from({ length: producers }, (_, producer) => produce_batch(
            queue,
            name,
            producer,
            per_producer,
            () => {
                enqueued += 1;
            },
            () => {
                producers_done += 1;
            },
        )),
        ...Array.from({ length: consumers }, () => consume_until_done(
            queue,
            name,
            count,
            claimed,
            payloads,
            () => producers_done === producers && enqueued === count,
        )),
    ]);

    assert.strictEqual(claimed.size, count);
    assert.strictEqual(payloads.size, count);
    assert.strictEqual(await queue.dequeue(name), null);
    assert.strictEqual(await queue.size(name), 0);
}

/**
 * @param {nb.MessageQueueClient} queue
 * @param {string} name
 * @param {number} producer
 * @param {number} per_producer
 * @param {() => void} on_enqueue
 * @param {() => void} on_done
 */
async function produce_batch(queue, name, producer, per_producer, on_enqueue, on_done) {
    for (let n = 0; n < per_producer; n++) {
        await queue.enqueue(name, {
            kind: 'deleted',
            object_ids: [`p${producer}-n${n}`],
            n: (producer * per_producer) + n,
        });
        on_enqueue();
    }
    on_done();
}

/**
 * @param {nb.MessageQueueClient} queue
 * @param {string} name
 * @param {number} count
 * @param {Set<string>} claimed
 * @param {Set<number>} payloads
 * @param {() => boolean} producers_finished
 */
async function consume_until_done(queue, name, count, claimed, payloads, producers_finished) {
    while (claimed.size < count) {
        const finished_before_poll = producers_finished();
        const message = await queue.dequeue(name);
        if (!message) {
            if (finished_before_poll && claimed.size === count) return;
            await P.delay(5);
            continue;
        }
        assert.ok(!claimed.has(message._id), `message ${message._id} was claimed twice`);
        claimed.add(message._id);
        const n = /** @type {{ n: number }} */ (message.payload).n;
        assert.ok(!payloads.has(n), `payload ${n} was claimed twice`);
        payloads.add(n);
        await queue.ack(message);
    }
}

exports.exercise_queue = exercise_queue;
exports.exercise_stale_ack = exercise_stale_ack;
exports.exercise_exhausted_claim = exercise_exhausted_claim;
exports.exercise_max_size = exercise_max_size;
exports.exercise_one_producer_one_consumer = exercise_one_producer_one_consumer;
exports.exercise_many_producers_many_consumers = exercise_many_producers_many_consumers;
