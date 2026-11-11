/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../../sdk/nb')} nb */

const mocha = require('mocha');
const assert = require('assert');

const config = require('../../../../config');
const replication_utils = require('../../../server/utils/replication_utils');
const replication_store = require('../../../server/system_services/replication_store').instance();
const system_store = require('../../../server/system_services/system_store').get_instance();
const replication_scanner = require('../../../server/bg_services/replication_scanner');
const { ReplicationScanner } = replication_scanner;
const { BgTaskExecutor, CONSUME_RESULT } = require('../../../server/bg_services/bg_task_executor');
const { BG_TASK_QUEUES } = require('../../../server/bg_services/bg_queues_utils');

const { MessageQueueType } = require('../../../util/message_queue_client');

mocha.describe('replication scanner queue', function() {

    mocha.it('scan enqueues a replicate task and the executor runs execute', async function() {
        const queue = new_memory_queue();
        const stubs = stub_replication_deps();
        const scanner = new_scan_probe(queue);
        const queue_type = config.MESSAGE_QUEUE_TYPE;
        config.MESSAGE_QUEUE_TYPE = 'postgres';
        const original_execute = ReplicationScanner.prototype._execute;
        ReplicationScanner.prototype._execute = async function() {
            return { had_copy_errors: false };
        };
        try {
            const result = { had_work: false, had_errors: false };
            await scanner.scan_rule({
                replication_id: 'rep-1',
                rule: { rule_id: 'rule-1', destination_bucket: 'dst-id' },
            }, result);

            assert.strictEqual(scanner.execute_called, false);
            assert.strictEqual(result.had_work, true);
            assert.strictEqual(stubs.updates.length, 1);
            assert.strictEqual(stubs.updates[0].status.src_cont_token, 'next-src');
            assert.strictEqual(await queue.size(BG_TASK_QUEUES.replication.queue), 1);

            const outcome = await consume_one(queue);

            assert.strictEqual(outcome, CONSUME_RESULT.OK);
            assert.strictEqual(stubs.updates.length, 1);
            assert.strictEqual(await queue.size(BG_TASK_QUEUES.replication.queue), 0);
        } finally {
            ReplicationScanner.prototype._execute = original_execute;
            config.MESSAGE_QUEUE_TYPE = queue_type;
            stubs.restore();
        }
    });

    mocha.it('enqueues replication work to the replication queue and connects without options', async function() {
        const queue = new_memory_queue();
        const stubs = stub_replication_deps();
        const scanner = new_scan_probe(queue);
        scanner._can_run = () => true;
        scanner.noobaa_connection = {};
        scanner.scan = async () => {
            const result = { had_work: false, had_errors: false };
            await scanner.scan_rule({
                replication_id: 'rep-1',
                rule: { rule_id: 'rule-1', destination_bucket: 'dst-id' },
            }, result);
            return result;
        };
        try {
            await scanner.run_batch();

            // The producer connects by name and lets connect apply the queue defaults - it passes no options.
            assert.strictEqual(queue.connect_options, undefined);
            assert.strictEqual(queue.connected_to, BG_TASK_QUEUES.replication.queue);
            assert.strictEqual(await queue.size(BG_TASK_QUEUES.replication.queue), 1);
        } finally {
            stubs.restore();
        }
    });

    mocha.it('nacks a scan task when the copy reports errors', async function() {
        const queue = new_memory_queue();
        const stubs = stub_replication_deps();
        const original_execute = ReplicationScanner.prototype._execute;
        let calls = 0;
        ReplicationScanner.prototype._execute = async function() {
            calls += 1;
            return { had_copy_errors: true };
        };
        try {
            await replication_utils.enqueue_replication_task(queue, replication_utils.REPLICATION_TASK_TYPE.SCAN, scan_task());
            assert.strictEqual(await consume_one(queue), CONSUME_RESULT.ERROR);
            assert.strictEqual(await consume_one(queue), CONSUME_RESULT.ERROR);
            assert.strictEqual(calls, 2);
            assert.strictEqual(await queue.size(BG_TASK_QUEUES.replication.queue), 1);
        } finally {
            ReplicationScanner.prototype._execute = original_execute;
            stubs.restore();
        }
    });

    mocha.it('nacks a replicate task when its buckets are missing', async function() {
        const queue = new_memory_queue();
        const stubs = stub_replication_deps();
        let looked_up = false;
        system_store.data = {
            get_by_id: () => {
                looked_up = true;
                return undefined;
            },
        };
        try {
            await replication_utils.enqueue_replication_task(
                queue, replication_utils.REPLICATION_TASK_TYPE.SCAN, scan_task());
            assert.strictEqual(await consume_one(queue), CONSUME_RESULT.ERROR);
            assert.strictEqual(looked_up, true);
            assert.strictEqual(await queue.size(BG_TASK_QUEUES.replication.queue), 1);
        } finally {
            stubs.restore();
        }
    });

    mocha.it('publishes scan metrics when the chunk finishes', async function() {
        const updates = [];
        const original_report = replication_utils.update_replication_prom_report;
        const original_copy = replication_utils.copy_objects;
        replication_utils.update_replication_prom_report = (_bucket, _id, rule_status, bucket_status) => {
            updates.push({
                writes: rule_status.last_cycle_writes_num,
                total: bucket_status.bucket_last_cycle_total_objects_num,
            });
        };
        replication_utils.copy_objects = async () => ({ num_of_objects: 1, size_of_objects: 10 });
        const scanner = new ReplicationScanner({
            name: 'metrics',
            client: /** @type {nb.APIClient} */ ({}),
        });
        const src_bucket = /** @type {{ name: nb.SensitiveString }} */ ({ name: 'src' });
        const dst_bucket = /** @type {{ name: nb.SensitiveString }} */ ({ name: 'dst' });
        try {
            await scanner._execute(src_bucket, dst_bucket, { a: [{ Size: 10 }] },
                'rep-metrics', 'rule-1', 'tok',
            );
            assert.strictEqual(updates.length, 1);
            assert.strictEqual(updates[0].total, 1);
            assert.strictEqual(updates[0].writes, 1);
            await scanner._execute(src_bucket, dst_bucket, { b: [{ Size: 10 }] },
                'rep-metrics', 'rule-1', 'tok',
            );
            assert.strictEqual(updates.length, 2);
            assert.strictEqual(updates[1].total, 1);
            assert.strictEqual(updates[1].writes, 1);
        } finally {
            replication_utils.update_replication_prom_report = original_report;
            replication_utils.copy_objects = original_copy;
        }
    });

    register_scan_chunking_tests();

    mocha.it('copies in the scanner when the queue type is none', async function() {
        const queue = new_memory_queue();
        const stubs = stub_replication_deps();
        const scanner = new_scan_probe(queue);
        scanner.queue_type = MessageQueueType.NONE;
        try {
            const result = { had_work: false, had_errors: false };
            await scanner.scan_rule({
                replication_id: 'rep-1',
                rule: { rule_id: 'rule-1', destination_bucket: 'dst-id' },
            }, result);
            assert.strictEqual(scanner.execute_called, true);
            assert.strictEqual(result.had_work, true);
            assert.strictEqual(result.had_errors, false);
            assert.strictEqual(stubs.updates.length, 1);
            assert.strictEqual(stubs.updates[0].status.src_cont_token, 'next-src');
            assert.strictEqual(await queue.size(BG_TASK_QUEUES.replication.queue), 0);
        } finally {
            stubs.restore();
        }
    });

    mocha.it('stores the task type on the queued message', async function() {
        const queue = new_memory_queue();
        await replication_utils.enqueue_replication_task(
            queue, replication_utils.REPLICATION_TASK_TYPE.SCAN, scan_task());
        const scan_message = await queue.dequeue(BG_TASK_QUEUES.replication.queue);
        assert.ok(scan_message);
        assert.strictEqual(scan_message.task_type, replication_utils.REPLICATION_TASK_TYPE.SCAN);
    });

    mocha.it('the scan worker rejects a task with no payload', async function() {
        const scanner = new ReplicationScanner({ name: 'reject', client: /** @type {nb.APIClient} */ ({}) });
        await assert.rejects(
            () => scanner.execute(/** @type {nb.QueueMessage} */ ({ payload: undefined })),
            /task payload is missing/,
        );
    });

    mocha.it('the executor nacks a task whose task_type has no worker (log is not wired yet)', async function() {
        const queue = new_memory_queue();
        const stubs = stub_replication_deps();
        try {
            // A log task is enqueued for the full picture, but no log worker is wired on this branch.
            await replication_utils.enqueue_replication_task(
                queue, replication_utils.REPLICATION_TASK_TYPE.LOG, { replication_id: 'rep-1', rule_id: 'rule-1' });
            assert.strictEqual(await consume_one(queue), CONSUME_RESULT.ERROR);
            assert.strictEqual(await queue.size(BG_TASK_QUEUES.replication.queue), 1);
        } finally {
            stubs.restore();
        }
    });
});

/**
 * @returns {object}
 */
function scan_task() {
    return {
        replication_id: 'rep-1',
        rule_id: 'rule-1',
        destination_bucket_id: 'dst-id',
        keys_diff_map: { key: [{}] },
        status: { last_cycle_start: 1 },
        src_cont_token: 'next-src',
        dst_cont_token: 'next-dst',
    };
}

function stub_replication_deps() {
    const original_find = replication_utils.find_src_and_dst_buckets;
    const original_update = replication_store.update_replication_status_by_id;
    const original_system_data = system_store.data;
    system_store.data = {
        get_by_id: id => ({ _id: id, name: `${id}-bucket` }),
    };
    /** @type {Array<{ id: string, rule_id: string, status: { src_cont_token?: string } }>} */
    const updates = [];
    replication_utils.find_src_and_dst_buckets = /** @type {typeof replication_utils.find_src_and_dst_buckets} */ (
        /** @type {unknown} */ (() => ({
            src_bucket: { _id: 'src', name: 'src-bucket' },
            dst_bucket: { _id: 'dst', name: 'dst-bucket' },
        }))
    );
    replication_store.update_replication_status_by_id = async (
        /** @type {string} */ id,
        /** @type {string} */ rule_id,
        /** @type {{ src_cont_token?: string }} */ status,
    ) => {
        updates.push({ id: String(id), rule_id: String(rule_id), status });
    };
    return {
        updates,
        restore() {
            replication_utils.find_src_and_dst_buckets = original_find;
            replication_store.update_replication_status_by_id = original_update;
            system_store.data = original_system_data;
        },
    };
}

/**
 * @param {nb.MessageQueueClient} queue
 * @returns {ReplicationScanner & { execute_called: boolean }}
 */
function new_scan_probe(queue) {
    const scanner = /** @type {ReplicationScanner & { execute_called: boolean }} */ (new ReplicationScanner({
        name: 'scan probe',
        client: /** @type {nb.APIClient} */ ({}),
        mq_client: queue,
    }));
    scanner.execute_called = false;
    scanner.validate_src = async () => true;
    scanner.validate_dst = async () => true;
    scanner.get_rule_diff = async () => ({
        keys_diff_map: { key: [{}] },
        src_cont_token: 'next-src',
        dst_cont_token: 'next-dst',
    });
    scanner._execute = async () => {
        scanner.execute_called = true;
        return { had_copy_errors: false };
    };
    return scanner;
}

/**
 * @returns {nb.MessageQueueClient}
 */
function new_memory_queue() {
    /** @type {Array<{ _id: string, queue: string, task_type: string, payload: object, terminal: boolean, claimed: boolean, acked: boolean, nacked: boolean }>} */
    const rows = [];
    let next_id = 1;

    /**
     * @param {{ _id: string }} message
     */
    function row_for(message) {
        const row = rows.find(item => item._id === message._id);
        if (!row) throw new Error(`missing message ${message._id}`);
        return row;
    }

    return {
        /**
         * @param {string} [queue]
         * @param {object} [options]
         * @returns {Promise<void>}
         */
        connect(queue, options) {
            this.connected_to = queue;
            this.connect_options = options;
            return Promise.resolve();
        },
        disconnect() {
            return Promise.resolve();
        },
        /**
         * @param {string} queue
         * @param {object} payload
         * @param {string} task_type
         * @returns {Promise<string>}
         */
        enqueue(queue, payload, task_type) {
            const _id = String(next_id);
            next_id += 1;
            rows.push({
                _id,
                queue,
                task_type,
                payload: JSON.parse(JSON.stringify(payload)),
                terminal: false,
                claimed: false,
                acked: false,
                nacked: false,
            });
            return Promise.resolve(_id);
        },
        /**
         * @param {string} queue
         * @returns {Promise<nb.QueueMessage | null>}
         */
        dequeue(queue) {
            const row = rows.find(item => item.queue === queue && !item.claimed && !item.acked);
            if (!row) return Promise.resolve(null);
            row.claimed = true;
            const now = new Date();
            return Promise.resolve({
                _id: row._id,
                queue: row.queue,
                task_type: row.task_type,
                payload: row.payload,
                retry_count: 0,
                lock_token: row._id,
                enqueued_at: now,
                visible_at: now,
                locked_until: now,
            });
        },
        /**
         * @param {nb.QueueMessage} message
         * @returns {boolean}
         */
        is_retry_limit_exceeded(message) {
            return row_for(message).terminal;
        },
        /**
         * @param {nb.QueueMessage} message
         * @returns {Promise<void>}
         */
        ack(message) {
            row_for(message).acked = true;
            return Promise.resolve();
        },
        /**
         * @param {nb.QueueMessage} message
         * @param {string} [_reason]
         * @returns {Promise<{ dropped: boolean }>}
         */
        nack(message, _reason) {
            const row = row_for(message);
            row.claimed = false;
            row.nacked = true;
            return Promise.resolve({ dropped: false });
        },
        /**
         * @param {string} queue
         * @returns {Promise<number>}
         */
        size(queue) {
            return Promise.resolve(rows.filter(item => item.queue === queue && !item.acked).length);
        },
        /**
         * @param {number} [_limit]
         * @returns {Promise<number>}
         */
        remove_expired_dead_messages(_limit) {
            return Promise.resolve(0);
        },
    };
}

/**
 * Dequeue one replication message with the background task executor.
 * @param {nb.MessageQueueClient} queue
 * @returns {Promise<typeof CONSUME_RESULT.EMPTY | typeof CONSUME_RESULT.OK | typeof CONSUME_RESULT.ERROR>}
 */
function consume_one(queue) {
    const task_executor = new BgTaskExecutor(/** @type {nb.APIClient} */ ({}));
    task_executor.mq_client = queue;
    // The constructor already built the task handlers (the scan execute closes over a ReplicationScanner).
    return task_executor.consume_message('replication');
}

/**
 * Chunking of a scan page into queue messages.
 * @returns {void}
 */
function register_scan_chunking_tests() {
    mocha.it('keeps the page in one message when the chunk size is not positive', async function() {
        const queue = new_memory_queue();
        const stubs = stub_replication_deps();
        const scanner = new_scan_probe(queue);
        const keys_diff_map = { a: [{}], b: [{}], c: [{}] };
        scanner.get_rule_diff = async () => ({
            keys_diff_map,
            src_cont_token: 'next-src',
            dst_cont_token: 'next-dst',
        });
        const queue_type = config.MESSAGE_QUEUE_TYPE;
        const chunk_size = config.REPLICATION_QUEUE_OBJECTS_PER_MESSAGE;
        config.MESSAGE_QUEUE_TYPE = 'postgres';
        try {
            for (const size of [-1, 0]) {
                config.REPLICATION_QUEUE_OBJECTS_PER_MESSAGE = size;
                await scanner.scan_rule({
                    replication_id: 'rep-1',
                    rule: { rule_id: 'rule-1', destination_bucket: 'dst-id' },
                }, { had_work: false, had_errors: false });
            }
            assert.strictEqual(await queue.size(BG_TASK_QUEUES.replication.queue), 2);
            for (let i = 0; i < 2; i++) {
                const message = await queue.dequeue(BG_TASK_QUEUES.replication.queue);
                const payload = /** @type {{ keys_diff_map: object }} */ (message.payload);
                assert.strictEqual(Object.keys(payload.keys_diff_map).length, 3);
            }
        } finally {
            config.MESSAGE_QUEUE_TYPE = queue_type;
            config.REPLICATION_QUEUE_OBJECTS_PER_MESSAGE = chunk_size;
            stubs.restore();
        }
    });

    mocha.it('scan enqueues one message per configured number of keys and commits the cursor once', async function() {
        const queue = new_memory_queue();
        const stubs = stub_replication_deps();
        const scanner = new_scan_probe(queue);
        const keys_diff_map = {};
        for (let i = 0; i < 120; i++) keys_diff_map[`key-${i}`] = [{}];
        scanner.get_rule_diff = async () => ({
            keys_diff_map,
            src_cont_token: 'next-src',
            dst_cont_token: 'next-dst',
        });
        const queue_type = config.MESSAGE_QUEUE_TYPE;
        const chunk_size = config.REPLICATION_QUEUE_OBJECTS_PER_MESSAGE;
        config.MESSAGE_QUEUE_TYPE = 'postgres';
        config.REPLICATION_QUEUE_OBJECTS_PER_MESSAGE = 50;
        try {
            await scanner.scan_rule({
                replication_id: 'rep-1',
                rule: { rule_id: 'rule-1', destination_bucket: 'dst-id' },
            }, { had_work: false, had_errors: false });

            assert.strictEqual(await queue.size(BG_TASK_QUEUES.replication.queue), 3);
            assert.strictEqual(stubs.updates.length, 1);
            assert.strictEqual(stubs.updates[0].status.src_cont_token, 'next-src');
            const sizes = [];
            for (let i = 0; i < 3; i++) {
                const message = await queue.dequeue(BG_TASK_QUEUES.replication.queue);
                const payload = /** @type {{ keys_diff_map: object }} */ (message.payload);
                sizes.push(Object.keys(payload.keys_diff_map).length);
            }
            assert.deepStrictEqual(sizes, [50, 50, 20]);
        } finally {
            config.MESSAGE_QUEUE_TYPE = queue_type;
            config.REPLICATION_QUEUE_OBJECTS_PER_MESSAGE = chunk_size;
            stubs.restore();
        }
    });

    mocha.it('enqueues nothing but commits the cursor and marks the target reachable when the diff is empty', async function() {
        const queue = new_memory_queue();
        const stubs = stub_replication_deps();
        const scanner = new_scan_probe(queue);
        scanner.get_rule_diff = async () => ({
            keys_diff_map: {},
            src_cont_token: 'next-src',
            dst_cont_token: 'next-dst',
        });
        const original_target_status = replication_utils.update_replication_target_status;
        /** @type {boolean | undefined} */
        let reachable;
        replication_utils.update_replication_target_status = (_rep, _src, _dst, is_reachable) => {
            reachable = is_reachable;
        };
        const queue_type = config.MESSAGE_QUEUE_TYPE;
        config.MESSAGE_QUEUE_TYPE = 'postgres';
        try {
            await scanner.scan_rule({
                replication_id: 'rep-1',
                rule: { rule_id: 'rule-1', destination_bucket: 'dst-id' },
            }, { had_work: false, had_errors: false });

            assert.strictEqual(await queue.size(BG_TASK_QUEUES.replication.queue), 0);
            assert.strictEqual(stubs.updates.length, 1);
            assert.strictEqual(stubs.updates[0].status.src_cont_token, 'next-src');
            // A fully-synced rule (empty diff) still refreshes its target-reachable metric in queue mode.
            assert.strictEqual(reachable, true);
        } finally {
            replication_utils.update_replication_target_status = original_target_status;
            config.MESSAGE_QUEUE_TYPE = queue_type;
            stubs.restore();
        }
    });

    mocha.it('keeps every version of a key in the same message', async function() {
        const queue = new_memory_queue();
        const stubs = stub_replication_deps();
        const scanner = new_scan_probe(queue);
        const versions = [{ VersionId: 'v1' }, { VersionId: 'v2' }, { VersionId: 'v3' }];
        const keys_diff_map = {
            'obj-a': versions,
            'obj-b': [{ VersionId: 'v1' }],
        };
        scanner.get_rule_diff = async () => ({
            keys_diff_map,
            src_cont_token: 'next-src',
            dst_cont_token: 'next-dst',
        });
        const queue_type = config.MESSAGE_QUEUE_TYPE;
        const chunk_size = config.REPLICATION_QUEUE_OBJECTS_PER_MESSAGE;
        config.MESSAGE_QUEUE_TYPE = 'postgres';
        config.REPLICATION_QUEUE_OBJECTS_PER_MESSAGE = 1;
        try {
            await scanner.scan_rule({
                replication_id: 'rep-1',
                rule: { rule_id: 'rule-1', destination_bucket: 'dst-id', sync_versions: true },
            }, { had_work: false, had_errors: false });

            assert.strictEqual(await queue.size(BG_TASK_QUEUES.replication.queue), 2);
            const pages = [];
            for (let i = 0; i < 2; i++) {
                const message = await queue.dequeue(BG_TASK_QUEUES.replication.queue);
                const payload = /** @type {{ keys_diff_map: Record<string, Array<{ VersionId: string }>> }} */ (message.payload);
                pages.push(payload.keys_diff_map);
            }
            assert.deepStrictEqual(pages[0]['obj-a'], versions);
            assert.strictEqual(Object.keys(pages[0]).length, 1);
            assert.deepStrictEqual(pages[1]['obj-b'], [{ VersionId: 'v1' }]);
            assert.strictEqual(Object.keys(pages[1]).length, 1);
        } finally {
            config.MESSAGE_QUEUE_TYPE = queue_type;
            config.REPLICATION_QUEUE_OBJECTS_PER_MESSAGE = chunk_size;
            stubs.restore();
        }
    });

    mocha.it('chunks by max versions limit while keeping versions of the same key together', function() {
        const { chunk_keys_diff_map } = replication_utils;
        const diff_map = {
            'key-1': [{ VersionId: 'v1' }, { VersionId: 'v2' }, { VersionId: 'v3' }],
            'key-2': [{ VersionId: 'v1' }, { VersionId: 'v2' }, { VersionId: 'v3' }],
            'key-3': [{ VersionId: 'v1' }],
        };

        // max_keys = 100, max_versions = 5
        // key-1 (3 versions) -> chunk 1
        // key-2 (3 versions) would make total 6 > 5 -> pushes chunk 1 {key-1}, starts chunk 2 {key-2}
        // key-3 (1 version) -> added to chunk 2 (3 + 1 = 4 <= 5)
        const chunks = chunk_keys_diff_map(diff_map, 100, 5);
        assert.strictEqual(chunks.length, 2);
        assert.deepStrictEqual(Object.keys(chunks[0]), ['key-1']);
        assert.deepStrictEqual(Object.keys(chunks[1]), ['key-2', 'key-3']);
    });

    mocha.it('flushes a key whose versions exceed max_versions into its own chunk', function() {
        const { chunk_keys_diff_map } = replication_utils;
        const heavy_versions = Array.from({ length: 10 }, (_, i) => ({ VersionId: `v${i}` }));
        const diff_map = {
            'small-1': [{ VersionId: 'v1' }],
            'heavy-key': heavy_versions,
            'small-2': [{ VersionId: 'v2' }],
        };

        // max_keys = 100, max_versions = 5
        // small-1 (1 version) -> chunk 1
        // heavy-key (10 versions > 5) -> flushes chunk 1 {small-1}, puts heavy-key in chunk 2 and flushes immediately
        // small-2 (1 version) -> chunk 3
        const chunks = chunk_keys_diff_map(diff_map, 100, 5);
        assert.strictEqual(chunks.length, 3);
        assert.deepStrictEqual(Object.keys(chunks[0]), ['small-1']);
        assert.deepStrictEqual(Object.keys(chunks[1]), ['heavy-key']);
        assert.deepStrictEqual(Object.keys(chunks[2]), ['small-2']);
        assert.strictEqual(chunks[1]['heavy-key'].length, 10);
    });
}
