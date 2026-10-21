/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../sdk/nb')} nb */
/**
 * @typedef {nb.DBCollection & {
 *   name: string,
 *   capacity: number,
 *   visibility_ms: string,
 *   retry_limit: number,
 *   dead_retention_ms: string,
 *   init_promise?: Promise<void>,
 * }} QueueTable
 */

const crypto = require('crypto');
const dbg = require('./debug_module')(__filename);
const config = require('../../config');
const db_client = require('./db_client');
const message_queue_schema = require('./message_queue_schema');
const message_queue_indexes = require('./message_queue_indexes');

// Queue name is the Postgres table name, interpolated into SQL unquoted.
// Unquoted identifiers are folded to lowercase and start with a letter or underscore.
const QUEUE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;

/**
 * Queue stored in the NooBaa Postgres database. Messages are stored as JSON.
 * Queries borrow a client from the shared db_client pool for that statement only.
 * One client handles many queues. connect(name) registers that queue's table on db_client.
 * The process must already have called db_client.connect().
 * The first claim stores retry_count 0, and each later claim adds 1.
 * A claim with retry_count above the queue's retry_limit is a redelivery after
 * the last allowed try. nack records it with dead_at so it leaves the live index.
 * retry_limit stays on the queue, set at connect.
 *
 * @implements {nb.MessageQueueClient}
 */
class PostgresMessageQueue {

    /** @type {PostgresMessageQueue | undefined} */
    static _instance;

    constructor() {
        /** @type {Map<string, QueueTable>} */
        this._queues = new Map();
    }

    /**
     * @returns {PostgresMessageQueue}
     */
    static instance() {
        PostgresMessageQueue._instance = PostgresMessageQueue._instance || new PostgresMessageQueue();
        return PostgresMessageQueue._instance;
    }

    /**
     * Register one queue table.
     * Call again with another name to register another queue.
     * A name already in this process returns that queue and keeps its settings.
     * The process must already have called db_client.connect(). define_collection
     * starts creating the table, and connect waits for that create to finish.
     * A retry limit of 0 is kept. Omitted arguments use the config defaults.
     * @param {string} name Postgres table for this queue.
     * @param {string} [visibility_ms] How long a claim stays locked. Defaults to MESSAGE_QUEUE_DEFAULT_VISIBILITY_MS.
     * @param {number} [retry_limit] Claims allowed before nack drops the message. Defaults to MESSAGE_QUEUE_DEFAULT_RETRY_LIMIT.
     * @param {string} [dead_retention_ms] How long a dead message stays before cleanup, in milliseconds. Defaults to MESSAGE_QUEUE_DEFAULT_DEAD_RETENTION_MS.
     * @returns {Promise<void>}
     */
    async connect(name, visibility_ms, retry_limit, dead_retention_ms) {
        validate_queue_name(name);
        const existing = this._queues.get(name);
        if (existing) {
            if (existing.init_promise) await existing.init_promise;
            return;
        }
        const db = db_client.instance();
        if (!db.is_connected()) {
            throw new Error('postgres message queue requires db_client to be connected');
        }
        const table = /** @type {QueueTable} */ (db.define_collection({
            name,
            schema: message_queue_schema,
            db_indexes: message_queue_indexes,
            capacity: config.MESSAGE_QUEUE_DEFAULT_CAPACITY,
        }));
        table.visibility_ms = visibility_ms ?? String(config.MESSAGE_QUEUE_DEFAULT_VISIBILITY_MS);
        table.retry_limit = retry_limit ?? config.MESSAGE_QUEUE_DEFAULT_RETRY_LIMIT;
        table.dead_retention_ms = dead_retention_ms ?? String(config.MESSAGE_QUEUE_DEFAULT_DEAD_RETENTION_MS);
        this._queues.set(name, table);
        if (table.init_promise) await table.init_promise;
    }

    /**
     * Leave the shared Postgres connection open.
     * @returns {Promise<void>}
     */
    async disconnect() { return undefined; }

    /**
     * enqueue inserts a new message into the queue with capacity check.
     * @param {string} queue
     * @param {object} payload
     * @returns {Promise<string>}
     */
    async enqueue(queue, payload) {
        const table = this._table(queue);
        const body = normalize_payload(payload);
        const _id = db_client.instance().new_object_id();
        const now = new Date();
        const message = { _id, payload: body, enqueued_at: now, visible_at: now };
        const capacity_condition = { dead_at: null };
        await table.insertOne(message, capacity_condition);
        return String(_id);
    }

    /**
     * dequeue uses FOR UPDATE SKIP LOCKED so concurrent workers each take a
     * different message. Each claim gets a lock token that ack and nack must
     * present, so a worker whose visibility lock expired cannot complete the
     * next claim
     * @param {string} queue
     * @returns {Promise<nb.QueueMessage | null>}
     */
    async dequeue(queue) {
        const table = this._table(queue);
        const token = crypto.randomBytes(16).toString('hex');
        const res = await this._query(
            `WITH candidate AS (
                 SELECT _id, (data->>'retry_count')::int AS retry_count
                 FROM ${table.name}
                 WHERE data->'dead_at' IS NULL
                   AND (data->>'visible_at')::timestamptz <= now()
                   AND (
                     data->'locked_until' IS NULL
                     OR (data->>'locked_until')::timestamptz < now()
                   )
                 ORDER BY _id
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1
             )
             UPDATE ${table.name} AS q
             SET data = q.data || jsonb_build_object(
                 'lock_token', $2::text,
                 'locked_until', now() + ($1::text || ' milliseconds')::interval,
                 'retry_count', CASE
                     WHEN candidate.retry_count IS NULL THEN 0
                     ELSE candidate.retry_count + 1 END
             )
             FROM candidate
             WHERE q._id = candidate._id
             RETURNING q._id, q.data`,
            [table.visibility_ms, token],
        );
        const row = res.rows[0];
        if (!row) return null;
        const data = row.data;
        return {
            _id: String(row._id).trim(),
            queue,
            payload: data.payload,
            retry_count: Number(data.retry_count),
            lock_token: token,
            enqueued_at: new Date(data.enqueued_at),
            visible_at: new Date(data.visible_at),
            locked_until: new Date(data.locked_until),
            last_error: data.last_error,
            dead_at: data.dead_at ? new Date(data.dead_at) : undefined,
        };
    }

    /**
     * size returns the number of live messages in the queue.
     * @param {string} queue
     * @returns {Promise<number>}
     */
    async size(queue) {
        const table = this._table(queue);
        const res = await this._query(
            `SELECT count(*)::int AS size FROM ${table.name}
             WHERE data->'dead_at' IS NULL`,
        );
        return Number(res.rows[0].size);
    }

    /**
     * ack deletes the message from the queue after it has been processed.
     * @param {nb.QueueMessage} message
     * @returns {Promise<void>}
     */
    async ack(message) {
        const table = this._table(message.queue);
        const token = this._lock_token(message);
        const res = await this._query(
            `DELETE FROM ${table.name}
             WHERE _id = $1
               AND data->>'lock_token' = $2 AND data->'dead_at' IS NULL`,
            [message._id, token],
        );
        if (!res.rowCount) {
            throw new Error(`postgres_message_queue: ack: could not delete message with _id ${message._id} locked by token ${token}`);
        }
    }

    /**
     * nack requeues the message after a delay.
     * @param {nb.QueueMessage} message
     * @param {string} [reason]
     * @returns {Promise<nb.MessageQueueNackResult>}
     */
    async nack(message, reason) {
        const table = this._table(message.queue);
        const token = this._lock_token(message);
        const retriable = message.retry_count < table.retry_limit;
        const values = [message._id, token, reason || ''];
        let patch;
        if (retriable) {
            const delay_ms = (message.retry_count + 1) * config.MESSAGE_QUEUE_DEFAULT_RETRY_DELAY_MS;
            values.push(String(delay_ms));
            patch = `jsonb_build_object('last_error', $3::text, 'visible_at', now() + ($4::text || ' milliseconds')::interval)`;
        } else {
            dbg.warn('postgres_message_queue: nack: postgres message queue marking message as dead after the retry limit', message._id, message.queue, reason);
            patch = `jsonb_build_object('dead_at', now(), 'last_error', $3::text)`;
        }
        const res = await this._query(
            `UPDATE ${table.name}
             SET data = (data - 'locked_until' - 'lock_token') || ${patch}
             WHERE _id = $1
               AND data->>'lock_token' = $2 AND data->'dead_at' IS NULL`,
            values,
        );
        if (!res.rowCount) {
            throw new Error(`postgres_message_queue: nack: could not update message with _id ${message._id} locked by token ${token}`);
        }
        return { dropped: !retriable };
    }

    /**
     * Return true when this claim must not be processed.
     * Call nack and skip the payload.
     * The limit is the one stored for this queue at connect.
     * The first claim stores retry_count 0. Each later claim adds 1, and the
     * claim after the last allowed try is above that limit.
     * @param {nb.QueueMessage} message Object returned by dequeue.
     * @returns {boolean}
     */
    is_exhausted_claim(message) {
        const table = this._table(message.queue);
        return message.retry_count > table.retry_limit;
    }

    /**
     * @param {string} text
     * @param {any[]} [values]
     */
    _query(text, values) {
        return db_client.instance().executeSQL(text, values || []);
    }

    /**
     * @param {nb.QueueMessage} message
     * @returns {string}
     */
    _lock_token(message) {
        if (!message || !message.lock_token) {
            throw new Error('postgres_message_queue: _lock_token: message has no lock token');
        }
        return message.lock_token;
    }

    /**
     * Delete dead messages older than each configured queue's retention.
     * Names come from MESSAGE_QUEUE_REGISTERED. A queue this process has connected
     * uses the retention from that connect. Any other configured queue uses
     * MESSAGE_QUEUE_DEFAULT_DEAD_RETENTION_MS. Each queue deletes up to limit rows.
     * A failed delete is skipped. The next cleaner pass retries it, including a
     * queue whose table is not created yet.
     * @param {number} limit Maximum rows to delete from each queue.
     * @returns {Promise<number>} Total rows deleted.
     */
    async remove_expired_dead_messages(limit) {
        let removed = 0;
        for (const name of config.MESSAGE_QUEUE_REGISTERED) {
            try {
                validate_queue_name(name);
                const connected = this._queues.get(name);
                const retention = connected ?
                    connected.dead_retention_ms :
                    String(config.MESSAGE_QUEUE_DEFAULT_DEAD_RETENTION_MS);
                const res = await this._query(
                    `DELETE FROM ${name}
                     WHERE _id IN (
                         SELECT _id FROM ${name}
                         WHERE data->'dead_at' IS NOT NULL
                           AND (data->>'dead_at')::timestamptz < now() - ($2::text || ' milliseconds')::interval
                         LIMIT $1
                     )`,
                    [limit, retention],
                );
                const count = res.rowCount || 0;
                dbg.log1('postgres_message_queue: remove_expired_dead_messages: removed', count, 'dead messages from', name);
                removed += count;
            } catch (err) {
                dbg.error('postgres_message_queue: remove_expired_dead_messages: failed to delete dead messages from', name, err);
            }
        }
        return removed;
    }

    /**
     * @param {string} name Queue registered with connect().
     * @returns {QueueTable}
     */
    _table(name) {
        validate_queue_name(name);
        const table = this._queues.get(name);
        if (!table) throw new Error(`postgres_message_queue: _table: queue ${name} is not connected`);
        return table;
    }

}

/**
 * Throw unless the queue name is a Postgres identifier.
 * The name is the table, so it is interpolated into SQL.
 * @param {string} queue Name passed to connect, enqueue, dequeue, or size.
 * @returns {void}
 */
function validate_queue_name(queue) {
    if (typeof queue !== 'string' || !QUEUE_NAME_PATTERN.test(queue)) {
        throw new Error(`invalid message queue name - ${queue}, use lowercase letters, digits, or underscores, and start with a letter or underscore`);
    }
}

/**
 * Return a copy of the payload.
 * @param {object} payload Value passed to enqueue. Must be an object, not an array.
 * @returns {object} Copy of payload.
 */
function normalize_payload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(`message queue payload must be a JSON object - ${payload}`);
    }
    return JSON.parse(JSON.stringify(payload));
}

exports.PostgresMessageQueue = PostgresMessageQueue;
exports.instance = PostgresMessageQueue.instance;
