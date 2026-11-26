/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

const dbg = require('../../util/debug_module')(__filename);
const chance = require('chance')();
const config = require('../../../config.js');
const message_queue_client = require('../../util/message_queue_client');
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const background_scheduler = require('../../util/background_scheduler').get_instance();
const bg_queues_utils = require('./bg_queues_utils');
const replication_scanner = require('./replication_scanner');
const replication_utils = require('../utils/replication_utils');

/** @typedef {(message: nb.QueueMessage) => Promise<void>} TaskExecute */

const CONSUME_RESULT = Object.freeze({ EMPTY: 'EMPTY', OK: 'OK', ERROR: 'ERROR' });

/**
 * Dequeues background tasks on config.BG_EXECUTOR_WORKERS loops.
 * Task queues are bg_queues_utils.BG_TASK_QUEUES - the same map producers enqueue to.
 * task_handlers maps each task name to an execute function per task_type. One queue can carry several task
 * types (replication carries scan and, later, log); the executor routes each dequeued message to the execute
 * for its task_type. A queue with a single task type has one entry.
 * Each turn a loop draws a random number and picks one of those names.
 */
class BgTaskExecutor {

    /**
     * @param {nb.APIClient} rpc_client Builds each task's worker.
     */
    constructor(rpc_client) {
        this.rpc_client = rpc_client;
        this.mq_client = undefined;
        this.workers_count = config.BG_EXECUTOR_WORKERS;
        this.task_names = [];
        this.task_weights = [];
        this.task_handlers = this.create_task_handlers();
    }

    /**
     * Build the execute functions, one per task name and task_type.
     * Each execute closes over the worker that runs the message, the way an lru_cache is built with its load
     * function. They reference the replication code, so they live here, not in the neutral shared registry.
     * @returns {Record<string, Record<string, TaskExecute>>}
     */
    create_task_handlers() {
        const replication_worker = new replication_scanner.ReplicationScanner(
            { name: 'replication executor worker', client: this.rpc_client });
        return {
            replication: {
                [replication_utils.REPLICATION_TASK_TYPE.SCAN]: message => replication_worker.execute(message),
            },
        };
    }

    /**
     * 1. Take the process message queue client. MESSAGE_QUEUE_TYPE selects it.
     * 2. Validate weights, handlers, BG_EXECUTOR_WORKERS, and the client.
     * 3. Save the task names and weights, and connect each queue with a positive weight.
     * 4. Register one background worker per workers count. Each worker calls run_task.
     * @returns {Promise<void>}
     */
    async init() {
        this.mq_client = message_queue_client.instance();
        this.validate_bg_task_executor();

        for (const [name, spec] of Object.entries(bg_queues_utils.BG_TASK_QUEUES)) {
            this.task_names.push(name);
            this.task_weights.push(spec.weight);
            if (spec.weight <= 0) continue;
            await this.mq_client.connect(spec.queue, spec.defaults);
        }

        for (let i = 0; i < this.workers_count; ++i) {
            background_scheduler.register_bg_worker({
                name: `bg executor ${i}`,
                delay: config.BG_EXECUTOR_EMPTY_DELAY,
                run_immediate: true,
            }, () => this.run_task());
        }
        dbg.log0('bg_task_executor: init: this.workers_count', this.workers_count,
            Object.keys(bg_queues_utils.BG_TASK_QUEUES).join(', '));
    }

    /**
     * @returns {Promise<number>}
     */
    async run_task() {
        if (!this.can_run()) return config.BG_EXECUTOR_EMPTY_DELAY;
        const name = this.choose_task_by_weight();
        if (!name) {
            dbg.log0(`bg_task_executor: run_task: no task was chosen to run ${name}`);
            return config.BG_EXECUTOR_EMPTY_DELAY;
        }
        const result = await this.consume_message(name);
        if (result === CONSUME_RESULT.ERROR) return config.BG_EXECUTOR_ERROR_DELAY;
        if (result === CONSUME_RESULT.OK) return config.BG_EXECUTOR_BATCH_DELAY;
        return config.BG_EXECUTOR_EMPTY_DELAY;
    }

    /**
     * Picks a task with chance.weighted using the names and weights saved in init.
     * A weight of 0 is not chosen.
     * @returns {string}
     */
    choose_task_by_weight() {
        return chance.weighted(this.task_names, this.task_weights);
    }

    /**
     * Dequeue one message for the chosen task and run it on the worker for its task_type.
     * Route by task_type to the execute that runs it. An unknown type is not enabled on this queue.
     * execute must be idempotent. A failed ack leaves the claim locked, and the next claim runs it again.
     * Dequeue, execute, and ack share one try so a queue error stays in this call.
     * @param {string} name
     * @returns {Promise<typeof CONSUME_RESULT.EMPTY | typeof CONSUME_RESULT.OK | typeof CONSUME_RESULT.ERROR>}
     */
    async consume_message(name) {
        const spec = bg_queues_utils.BG_TASK_QUEUES[name];
        const handlers = this.task_handlers[name];

        /** @type {nb.QueueMessage | undefined} */
        let message;
        let executed = false;
        try {
            const dequeued = await this.mq_client.dequeue(spec.queue);
            if (!dequeued) return CONSUME_RESULT.EMPTY;
            message = dequeued;

            if (this.mq_client.is_retry_limit_exceeded(message)) {
                dbg.warn('bg_task_executor: consume_message: dropping task after retry limit',
                    name, message._id, message.retry_count);
                await this.nack_message(name, message, 'retry limit exceeded');
                return CONSUME_RESULT.ERROR;
            }

            const execute = handlers[message.task_type];
            if (!execute) {
                throw new Error(`bg_task_executor: consume_message: task type ${message.task_type} is not enabled for ${name}`);
            }

            dbg.log1('bg_task_executor: consume_message: executing task', name, message.task_type, message._id);
            await execute(message);
            executed = true;

            await this.mq_client.ack(message);
            return CONSUME_RESULT.OK;
        } catch (err) {
            dbg.error('bg_task_executor: consume_message: failed', name, message && message._id, err);
            if (message && !executed) {
                const reason = err instanceof Error ? err.message : String(err);
                await this.nack_message(name, message, reason);
            }
            return CONSUME_RESULT.ERROR;
        }
    }

    /**
     * @returns {boolean}
     */
    can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('bg_task_executor: can_run:', 'system_store did not finish initial load');
            return false;
        }
        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;
        return true;
    }

    /**
     * nack once. A failure here is logged and swallowed so the caller still returns an error delay.
     * @param {string} name
     * @param {nb.QueueMessage} message
     * @param {string} reason
     * @returns {Promise<void>}
     */
    async nack_message(name, message, reason) {
        try {
            await this.mq_client.nack(message, reason);
        } catch (err) {
            dbg.error('bg_task_executor: nack_message: failed to nack', name, message._id, err);
        }
    }

    /**
     * 1. Every task must have a weight, and that weight cannot be negative.
     * 2. Configured weights must sum to 100.
     * 3. Every task must have a handler, including a task whose weight is 0.
     * 4. BG_EXECUTOR_WORKERS must be a positive integer.
     * 5. The message queue client must be configured.
     */
    validate_bg_task_executor() {
        this.validate_task_weights();
        this.validate_task_weight_sum();
        this.validate_task_handlers();
        this.validate_worker_count();
        this.validate_message_queue_client();
    }

    /**
     * Every task must have a weight, and that weight cannot be negative.
     */
    validate_task_weights() {
        for (const [name, spec] of Object.entries(bg_queues_utils.BG_TASK_QUEUES)) {
            if (spec.weight === undefined) {
                const str = `bg_task_executor: task ${name} has no weight`;
                dbg.error(str);
                throw new Error(str);
            }
            if (spec.weight < 0) {
                const str = `bg_task_executor: task ${name} weight ${spec.weight} is negative`;
                dbg.error(str);
                throw new Error(str);
            }
        }
    }

    /**
     * Configured weights must sum to 100.
     */
    validate_task_weight_sum() {
        let weight_sum = 0;
        for (const spec of Object.values(bg_queues_utils.BG_TASK_QUEUES)) {
            weight_sum += spec.weight;
        }
        if (weight_sum !== 100) {
            const str = `bg_task_executor: task weights sum to ${weight_sum}, expected 100`;
            dbg.error(str);
            throw new Error(str);
        }
    }

    /**
     * Every task must have at least one task_type execute function, including a task whose weight is 0.
     */
    validate_task_handlers() {
        for (const name of Object.keys(bg_queues_utils.BG_TASK_QUEUES)) {
            const handlers = this.task_handlers[name];
            const executes = handlers ? Object.values(handlers) : [];
            if (executes.length && executes.every(execute => typeof execute === 'function')) continue;
            const str = `bg_task_executor: task ${name} has no handler`;
            dbg.error(str);
            throw new Error(str);
        }
    }

    /**
     * BG_EXECUTOR_WORKERS must be a positive integer.
     */
    validate_worker_count() {
        const worker_count = this.workers_count;
        if (!Number.isInteger(worker_count) || worker_count <= 0) {
            const str = `bg_task_executor: init: BG_EXECUTOR_WORKERS ${worker_count} is a misconfiguration`;
            dbg.error(str);
            throw new Error(str);
        }
    }

    /**
     * The message queue client must be configured.
     */
    validate_message_queue_client() {
        if (!this.mq_client) throw new Error('bg_task_executor: init: message queue client is not configured');
    }
}

/** @type {BgTaskExecutor | undefined} */
let _instance;

/**
 * @param {nb.APIClient} rpc_client
 * @returns {BgTaskExecutor}
 */
function get_instance(rpc_client) {
    _instance = _instance || new BgTaskExecutor(rpc_client);
    return _instance;
}

exports.CONSUME_RESULT = CONSUME_RESULT;
exports.BgTaskExecutor = BgTaskExecutor;
exports.get_instance = get_instance;
