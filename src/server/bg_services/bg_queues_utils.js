/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

const config = require('../../../config.js');

const CONSUME_RESULT = Object.freeze({ EMPTY: 'EMPTY', OK: 'OK', ERROR: 'ERROR' });

/**
 * One task queue. Producers and the executor share this shape.
 * execute is required, including when weight is 0, so a later weight change still has a handler.
 * execute must be idempotent. A handler that finishes and then fails its ack runs again after the visibility timeout.
 * The process has one queue client, shared by every task. MESSAGE_QUEUE_TYPE selects it.
 * @typedef {{
 *   queue: string,
 *   weight: number,
 *   execute: (message: nb.QueueMessage, rpc_client: nb.APIClient) => Promise<void>,
 *   defaults: {
 *     visibility_ms: number,
 *     retry_limit: number,
 *     dead_retention_ms: number,
 *     retry_delay_ms: number,
 *   },
 * }} BgTaskSpec
 */

/**
 * Queue settings for each task. Producers and the executor read these entries directly.
 * Producer and consumer connect with the same defaults.
 * execute is required, including when weight is 0, so a later weight change still has a handler.
 * execute must be idempotent. A handler that finishes and then fails its ack runs again after the visibility timeout.
 * TODO: execute handlers will be added in the next PRs. Nothing enqueues to these queues yet, so the not-implemented handler is safe.
 * The object is frozen. Tests replace the export with their own map.
 * @type {Record<string, BgTaskSpec>}
 */
const BG_TASK_QUEUES = {
    replication: {
        queue: 'replication_mq',
        weight: config.REPLICATION_EXECUTOR_WEIGHT,
        execute: () => {
            throw new Error('not implemented');
        },
        defaults: {
            visibility_ms: config.MESSAGE_QUEUE_DEFAULT_VISIBILITY_MS,
            retry_limit: config.MESSAGE_QUEUE_DEFAULT_RETRY_LIMIT,
            dead_retention_ms: config.MESSAGE_QUEUE_DEFAULT_DEAD_RETENTION_MS,
            retry_delay_ms: config.MESSAGE_QUEUE_DEFAULT_RETRY_DELAY_MS,
        },
    },
};

exports.CONSUME_RESULT = CONSUME_RESULT;
exports.BG_TASK_QUEUES = BG_TASK_QUEUES;
