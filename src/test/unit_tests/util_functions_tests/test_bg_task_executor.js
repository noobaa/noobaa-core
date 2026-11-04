/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../../sdk/nb')} nb */
/** @typedef {import('../../../server/bg_services/bg_queues_utils').BgTaskSpec} BgTaskSpec */

const mocha = require('mocha');
const assert = require('assert');
const Chance = require('chance');
const sinon = require('sinon');

const config = require('../../../../config');
const message_queue_client = require('../../../util/message_queue_client');
const background_scheduler = require('../../../util/background_scheduler').get_instance();
const system_store = require('../../../server/system_services/system_store').get_instance();
const system_utils = require('../../../server/utils/system_utils');
const bg_queues_utils = require('../../../server/bg_services/bg_queues_utils');
const { CONSUME_RESULT } = bg_queues_utils;
const { BgTaskExecutor, get_instance } = require('../../../server/bg_services/bg_task_executor');

const TRANSITION_DEFAULTS = Object.freeze({
    visibility_ms: 1000,
    retry_limit: 1,
    dead_retention_ms: 1000,
    retry_delay_ms: 1000,
});

const REPLICATION_DEFAULTS = Object.freeze({
    visibility_ms: 2000,
    retry_limit: 2,
    dead_retention_ms: 2000,
    retry_delay_ms: 2000,
});

mocha.describe('bg_task_executor', function() {
    const worker_count = config.BG_EXECUTOR_WORKERS;
    const initial_load = system_store.is_finished_initial_load;
    const initial_data = system_store.data;
    const task_queues = bg_queues_utils.BG_TASK_QUEUES;

    mocha.afterEach(function() {
        bg_queues_utils.BG_TASK_QUEUES = task_queues;
        config.BG_EXECUTOR_WORKERS = worker_count;
        system_store.is_finished_initial_load = initial_load;
        system_store.data = initial_data;
        sinon.restore();
    });

    mocha.it('constructor stores the rpc client', function() {
        const rpc = rpc_client();
        const fresh = new BgTaskExecutor(rpc);

        assert.strictEqual(fresh.rpc_client, rpc);
        assert.strictEqual(fresh.mq_client, undefined);
    });

    mocha.it('rejects a worker count that cannot run', function() {
        config.BG_EXECUTOR_WORKERS = 0;
        const executor = executor_with_tasks();
        assert.throws(() => executor.validate_bg_task_executor(), /BG_EXECUTOR_WORKERS 0 is a misconfiguration/);
    });

    mocha.it('asks chance.weighted to pick a task', async function() {
        const executor = executor_with_tasks();
        set_weights({ replication: 80, transition: 20 });
        await init_executor(executor);
        const weighted = sinon.stub(Chance.prototype, 'weighted').returns('transition');

        assert.strictEqual(executor.choose_task_by_weight(), 'transition');
        assert.deepStrictEqual(weighted.firstCall.args, [
            ['replication', 'transition'],
            [80, 20],
        ]);
    });

    mocha.it('rejects a negative weight', function() {
        const executor = executor_with_tasks();
        set_weights({ transition: -10, replication: 110 });
        assert.throws(() => executor.validate_bg_task_executor(), /task transition weight -10 is negative/);
    });

    mocha.it('rejects weights that do not sum to 100', function() {
        const executor = executor_with_tasks();
        set_weights({ replication: 80 });
        assert.throws(() => executor.validate_bg_task_executor(), /task weights sum to 80, expected 100/);
    });

    mocha.it('rejects a task with no weight', function() {
        const executor = executor_with_tasks();
        drop_field('transition', 'weight');
        assert.throws(() => executor.validate_bg_task_executor(), /task transition has no weight/);
    });

    mocha.it('rejects a task with no handler', function() {
        const executor = executor_with_tasks();
        drop_field('replication', 'execute');
        assert.throws(() => executor.validate_bg_task_executor(), /task replication has no handler/);
    });

    mocha.it('rejects a zero-weight task with no handler', function() {
        const executor = executor_with_tasks();
        drop_field('transition', 'execute');
        assert.throws(() => executor.validate_bg_task_executor(), /task transition has no handler/);
    });

    mocha.it('skips a task whose weight is not positive', async function() {
        const executor = executor_with_tasks();
        set_weights({ transition: 0, replication: 100 });
        await init_executor(executor);

        assert.strictEqual(executor.choose_task_by_weight(), 'replication');
    });

    mocha.it('dequeues the queue selected by the draw', async function() {
        /** @type {string[]} */
        const seen = [];
        const executor = executor_with_tasks(seen);
        set_weights({ transition: 20, replication: 80 });
        await init_executor(executor);
        executor.mq_client = fake_queue(seen, true);
        sinon.stub(executor, 'can_run').returns(true);
        const weighted = sinon.stub(Chance.prototype, 'weighted');
        weighted.onFirstCall().returns('transition');
        weighted.onSecondCall().returns('replication');

        assert.strictEqual(await executor.run_task(), config.BG_EXECUTOR_BATCH_DELAY);
        assert.strictEqual(await executor.run_task(), config.BG_EXECUTOR_BATCH_DELAY);

        assert.deepStrictEqual(seen, [
            'dequeue:transition_q',
            'execute:transition',
            'ack:transition_q',
            'dequeue:replication_q',
            'execute:replication',
            'ack:replication_q',
        ]);
    });

    mocha.it('waits when the chosen queue is empty', async function() {
        const executor = executor_with_tasks();
        await init_executor(executor);
        /** @type {string[]} */
        const seen = [];
        executor.mq_client = fake_queue(seen, false);
        sinon.stub(executor, 'can_run').returns(true);
        sinon.stub(Chance.prototype, 'weighted').returns('replication');

        assert.strictEqual(await executor.run_task(), config.BG_EXECUTOR_EMPTY_DELAY);
        assert.deepStrictEqual(seen, ['dequeue:replication_q']);
    });

    mocha.it('waits when no task is chosen', async function() {
        const executor = executor_with_tasks();
        await init_executor(executor);
        sinon.stub(executor, 'can_run').returns(true);
        sinon.stub(executor, 'choose_task_by_weight').returns('');

        assert.strictEqual(await executor.run_task(), config.BG_EXECUTOR_EMPTY_DELAY);
    });

    mocha.it('does not dequeue while the system cannot run', async function() {
        const executor = executor_with_tasks();
        /** @type {string[]} */
        const seen = [];
        executor.mq_client = fake_queue(seen, true);
        sinon.stub(executor, 'can_run').returns(false);

        assert.strictEqual(await executor.run_task(), config.BG_EXECUTOR_EMPTY_DELAY);
        assert.deepStrictEqual(seen, []);
    });

    mocha.it('can_run waits until the system store has loaded', function() {
        system_store.is_finished_initial_load = false;
        const executor = executor_with_tasks();

        assert.strictEqual(executor.can_run(), false);
    });

    mocha.it('can_run waits when the system record is missing', function() {
        system_store.is_finished_initial_load = true;
        system_store.data = system_data([]);
        const executor = executor_with_tasks();

        assert.strictEqual(executor.can_run(), false);
    });

    mocha.it('can_run waits during maintenance', function() {
        system_store.is_finished_initial_load = true;
        system_store.data = system_data([{ _id: 'sys1' }]);
        sinon.stub(system_utils, 'system_in_maintenance').returns(true);
        const executor = executor_with_tasks();

        assert.strictEqual(executor.can_run(), false);
    });

    mocha.it('can_run allows a loaded system that is not in maintenance', function() {
        system_store.is_finished_initial_load = true;
        system_store.data = system_data([{ _id: 'sys1' }]);
        sinon.stub(system_utils, 'system_in_maintenance').returns(false);
        const executor = executor_with_tasks();

        assert.strictEqual(executor.can_run(), true);
    });

    mocha.it('nacks a failed task and backs off', async function() {
        const executor = executor_with_tasks();
        bg_queues_utils.BG_TASK_QUEUES.replication.execute = async () => {
            throw new Error('copy failed');
        };
        await init_executor(executor);
        /** @type {string[]} */
        const seen = [];
        executor.mq_client = fake_queue(seen, true);
        sinon.stub(executor, 'can_run').returns(true);
        sinon.stub(Chance.prototype, 'weighted').returns('replication');

        assert.strictEqual(await executor.run_task(), config.BG_EXECUTOR_ERROR_DELAY);
        assert.deepStrictEqual(seen, ['dequeue:replication_q', 'nack:replication_q']);
    });

    mocha.it('nacks a failed task whose error is not an Error', async function() {
        const executor = executor_with_tasks();
        bg_queues_utils.BG_TASK_QUEUES.replication.execute = () => {
            const failure = { toString: () => 'copy failed' };
            // The catch turns a non-Error rejection into the nack reason.
            // eslint-disable-next-line prefer-promise-reject-errors
            return Promise.reject(failure);
        };
        /** @type {string[]} */
        const reasons = [];
        executor.mq_client = fake_queue([], true, { reasons });

        assert.strictEqual(await executor.consume_message('replication'), CONSUME_RESULT.ERROR);
        assert.deepStrictEqual(reasons, ['copy failed']);
    });

    mocha.it('passes the rpc client to execute', async function() {
        const executor = executor_with_tasks();
        /** @type {nb.APIClient | undefined} */
        let seen_rpc;
        bg_queues_utils.BG_TASK_QUEUES.replication.execute = async (_message, rpc) => {
            seen_rpc = rpc;
        };
        executor.mq_client = fake_queue([], true);

        assert.strictEqual(await executor.consume_message('replication'), CONSUME_RESULT.OK);
        assert.strictEqual(seen_rpc, executor.rpc_client);
    });

    mocha.it('drops a message past the retry limit without executing it', async function() {
        /** @type {string[]} */
        const seen = [];
        const executor = executor_with_tasks(seen);
        executor.mq_client = fake_queue(seen, true, { retry_exceeded: true });

        assert.strictEqual(await executor.consume_message('replication'), CONSUME_RESULT.ERROR);
        assert.deepStrictEqual(seen, ['dequeue:replication_q', 'nack:replication_q']);
    });

    mocha.it('returns an error delay when dequeue throws', async function() {
        const executor = executor_with_tasks();
        await init_executor(executor);
        /** @type {string[]} */
        const seen = [];
        executor.mq_client = fake_queue(seen, true, { dequeue_error: 'db down' });
        sinon.stub(executor, 'can_run').returns(true);
        sinon.stub(Chance.prototype, 'weighted').returns('replication');

        assert.strictEqual(await executor.run_task(), config.BG_EXECUTOR_ERROR_DELAY);
        assert.deepStrictEqual(seen, ['dequeue:replication_q']);
    });

    mocha.it('does not nack when ack fails after execute', async function() {
        /** @type {string[]} */
        const seen = [];
        const executor = executor_with_tasks(seen);
        executor.mq_client = fake_queue(seen, true, { ack_failures: 1 });

        assert.strictEqual(await executor.consume_message('replication'), CONSUME_RESULT.ERROR);
        assert.deepStrictEqual(seen, ['dequeue:replication_q', 'execute:replication', 'ack:replication_q']);
    });

    mocha.it('returns an error when nack fails', async function() {
        /** @type {string[]} */
        const seen = [];
        const executor = executor_with_tasks(seen);
        bg_queues_utils.BG_TASK_QUEUES.replication.execute = async () => {
            throw new Error('copy failed');
        };
        executor.mq_client = fake_queue(seen, true, { nack_failures: 1 });

        assert.strictEqual(await executor.consume_message('replication'), CONSUME_RESULT.ERROR);
        assert.deepStrictEqual(seen, ['dequeue:replication_q', 'nack:replication_q']);
    });

    mocha.it('consume_message rejects an unknown task', async function() {
        const executor = executor_with_tasks();
        executor.mq_client = fake_queue([], false);
        await assert.rejects(() => executor.consume_message('missing'), /missing is not configured/);
    });

    mocha.it('starts one loop per configured worker', async function() {
        config.BG_EXECUTOR_WORKERS = 3;
        const executor = executor_with_tasks();
        const client = queue_client();
        sinon.stub(message_queue_client, 'instance').returns(client);
        const register = sinon.stub(background_scheduler, 'register_bg_worker');

        await executor.init();

        assert.deepStrictEqual(client.connected, [
            ['replication_q', REPLICATION_DEFAULTS],
        ]);
        assert.strictEqual(register.callCount, 3);
        assert.deepStrictEqual(register.getCalls().map(call => call.args[0].name), [
            'bg executor 0',
            'bg executor 1',
            'bg executor 2',
        ]);
    });

    mocha.it('connects each task queue', async function() {
        const executor = executor_with_tasks();
        set_weights({ transition: 20, replication: 80 });
        bg_queues_utils.BG_TASK_QUEUES.replication.queue = bg_queues_utils.BG_TASK_QUEUES.transition.queue;
        const client = queue_client();
        sinon.stub(message_queue_client, 'instance').returns(client);
        sinon.stub(background_scheduler, 'register_bg_worker');

        await executor.init();

        assert.deepStrictEqual(client.connected.map(entry => entry[0]), ['transition_q', 'transition_q']);
    });

    mocha.it('rejects init when the process has no queue client', async function() {
        const executor = executor_with_tasks();
        sinon.stub(message_queue_client, 'instance').returns(undefined);
        sinon.stub(background_scheduler, 'register_bg_worker');

        await assert.rejects(() => executor.init(), /message queue client is not configured/);
    });

    mocha.it('get_instance returns the first executor', function() {
        executor_with_tasks();
        const first_rpc = rpc_client();
        const first = get_instance(first_rpc);
        const second = get_instance(rpc_client());

        assert.strictEqual(second, first);
        assert.strictEqual(second.rpc_client, first_rpc);
    });
});

/**
 * @returns {nb.APIClient}
 */
function rpc_client() {
    return /** @type {nb.APIClient} */ ({});
}

/**
 * @param {BgTaskExecutor} executor
 * @returns {Promise<void>}
 */
async function init_executor(executor) {
    sinon.stub(message_queue_client, 'instance').returns(queue_client());
    sinon.stub(background_scheduler, 'register_bg_worker');
    await executor.init();
}

/**
 * Registers transition and replication under those names.
 * @param {string[]} [seen]
 * @returns {BgTaskExecutor}
 */
function executor_with_tasks(seen) {
    bg_queues_utils.BG_TASK_QUEUES = {
        transition: {
            queue: 'transition_q',
            defaults: TRANSITION_DEFAULTS,
            weight: 0,
            execute: async () => {
                if (seen) seen.push('execute:transition');
            },
        },
        replication: {
            queue: 'replication_q',
            defaults: REPLICATION_DEFAULTS,
            weight: config.REPLICATION_EXECUTOR_WEIGHT,
            execute: async () => {
                if (seen) seen.push('execute:replication');
            },
        },
    };
    return new BgTaskExecutor(rpc_client());
}

/**
 * Rebuilds BG_TASK_QUEUES in weight-key order and keeps each existing entry.
 * @param {Record<string, number>} weights
 */
function set_weights(weights) {
    /** @type {Record<string, BgTaskSpec>} */
    const queues = {};
    for (const [name, weight] of Object.entries(weights)) {
        const spec = bg_queues_utils.BG_TASK_QUEUES[name];
        queues[name] = { ...spec, weight };
    }
    bg_queues_utils.BG_TASK_QUEUES = queues;
}

/**
 * @param {string} name
 * @param {string} field
 */
function drop_field(name, field) {
    const spec = { ...bg_queues_utils.BG_TASK_QUEUES[name] };
    delete /** @type {Record<string, unknown>} */ (spec)[field];
    bg_queues_utils.BG_TASK_QUEUES = {
        ...bg_queues_utils.BG_TASK_QUEUES,
        [name]: /** @type {BgTaskSpec} */ (spec),
    };
}

/**
 * @param {Array<{ _id: string }>} systems
 */
function system_data(systems) {
    return /** @type {any} */ ({ systems });
}

/**
 * @param {string} queue
 * @returns {nb.QueueMessage}
 */
function queue_message(queue) {
    return {
        _id: `${queue}-id`,
        queue,
        payload: {},
        retry_count: 0,
        lock_token: 'lock',
        enqueued_at: new Date(),
        locked_until: new Date(),
    };
}

/**
 * @param {string[]} seen
 * @param {boolean} has_message
 * @param {{
 *   ack_failures?: number,
 *   nack_failures?: number,
 *   dequeue_error?: string,
 *   retry_exceeded?: boolean,
 *   reasons?: string[],
 * }} [options]
 * @returns {nb.MessageQueueClient}
 */
function fake_queue(seen, has_message, options) {
    const opts = options || {};
    let ack_failures = opts.ack_failures || 0;
    let nack_failures = opts.nack_failures || 0;
    return /** @type {nb.MessageQueueClient} */ (/** @type {unknown} */ ({
        /**
         * @param {string} queue
         * @returns {Promise<nb.QueueMessage | null>}
         */
        async dequeue(queue) {
            seen.push(`dequeue:${queue}`);
            if (opts.dequeue_error) throw new Error(opts.dequeue_error);
            if (!has_message) return null;
            return queue_message(queue);
        },
        /**
         * @param {nb.QueueMessage} message
         */
        async ack(message) {
            seen.push(`ack:${message.queue}`);
            if (ack_failures > 0) {
                ack_failures -= 1;
                throw new Error('ack failed');
            }
        },
        /**
         * @param {nb.QueueMessage} message
         * @param {string} [reason]
         * @returns {Promise<nb.MessageQueueNackResult>}
         */
        async nack(message, reason) {
            seen.push(`nack:${message.queue}`);
            if (opts.reasons && reason) opts.reasons.push(reason);
            if (nack_failures > 0) {
                nack_failures -= 1;
                throw new Error('nack failed');
            }
            return { dropped: false };
        },
        is_retry_limit_exceeded() {
            return Boolean(opts.retry_exceeded);
        },
    }));
}

/**
 * @returns {nb.MessageQueueClient & { connected: [string, object | undefined][] }}
 */
function queue_client() {
    /** @type {[string, object | undefined][]} */
    const connected = [];
    const client = /** @type {nb.MessageQueueClient & { connected: [string, object | undefined][] }} */ (/** @type {unknown} */ ({
        connected,
        /**
         * @param {string} queue
         * @param {object} [defaults]
         */
        async connect(queue, defaults) {
            connected.push([queue, defaults]);
        },
    }));
    return client;
}
