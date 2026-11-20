/* Copyright (C) 2016 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
const { setup, rpc_client, POOL_LIST } = coretest;
setup({ pools_to_create: [POOL_LIST[1]] });

const mocha = require('mocha');
const assert = require('assert');
const timer = require('node:timers/promises');
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

const config = require('../../../../config');
const CONSTANTS = require('../../../common/constants');
const buffer_utils = require('../../../util/buffer_utils');
const db_client = require('../../../util/db_client');
const http_utils = require('../../../util/http_utils');
const ObjectIO = require('../../../sdk/object_io');
const { ObjectsReclaimer } = require('../../../server/bg_services/objects_reclaimer');
const { AgentBlocksReclaimer } = require('../../../server/bg_services/agent_blocks_reclaimer');
const db_cleaner = require('../../../server/bg_services/db_cleaner');
const md_aggregator = require('../../../server/bg_services/md_aggregator');
const system_store_mod = require('../../../server/system_services/system_store');
const { MDStore } = require('../../../server/object_services/md_store');
const map_deleter = require('../../../server/object_services/map_deleter');
const mapper = require('../../../server/object_services/mapper');
const { ChunkDB } = require('../../../server/object_services/map_db_types');
const {
    create_archive_bucket,
    delete_archive_bucket,
    upload_and_patch,
    assert_object_not_deleted,
} = require('../../utils/reclaimers_test_utils');

const object_io = new ObjectIO();
object_io.set_verification_mode();

const BUCKET = 'test-objects-reclaimer-expire';
const STD_BUCKET = 'test-objects-reclaimer-standard';
const ARCHIVE_NAMES = {
    bucket: BUCKET,
    archive_target_bucket: 'test-objects-reclaimer-expire-archive-target',
    archive_connection: 'objects_reclaimer_expire_archive_connection',
    archive_nsr: 'objects_reclaimer_expire_archive_nsr',
};

mocha.describe('ObjectsReclaimer', function() {
    this.timeout(120000); // eslint-disable-line no-invalid-this

    /** @type {InstanceType<typeof ObjectsReclaimer>} */
    let reclaimer;

    mocha.before(async function() {
        this.timeout(300000); // eslint-disable-line no-invalid-this
        await create_archive_bucket(ARCHIVE_NAMES);
        await rpc_client.bucket.create_bucket({
            name: STD_BUCKET,
            // Small chunks so a few hundred bytes become multiple parts.
            chunk_split_config: {
                avg_chunk: 100,
                delta_chunk: 50,
            },
        });
        reclaimer = new ObjectsReclaimer({ name: 'test_object_reclaimer', client: rpc_client });
        // Shared CI DBs can leave a large unreclaimed backlog that fills
        // OBJECT_RECLAIMER_BATCH_SIZE and makes single-batch assertions flaky.
        await drain_unreclaimed_queue(reclaimer);
    });

    mocha.after(async function() {
        await delete_archive_bucket(ARCHIVE_NAMES);
        try {
            const { objects } = await rpc_client.object.list_objects({ bucket: STD_BUCKET, limit: 1000 });
            if (objects.length) {
                await rpc_client.object.delete_multiple_objects({
                    bucket: STD_BUCKET,
                    objects: objects.map(obj => ({ key: obj.key })),
                });
            }
            await rpc_client.bucket.delete_bucket({ name: STD_BUCKET });
        } catch (_err) {
            // ignore cleanup failures
        }
    });

    mocha.describe('run_batch', function() {
        mocha.it('returns a configured delay', async function() {
            const delay = await reclaimer.run_batch();
            assert.ok([
                config.OBJECT_RECLAIMER_EMPTY_DELAY,
                config.OBJECT_RECLAIMER_BATCH_DELAY,
                config.OBJECT_RECLAIMER_ERROR_DELAY,
            ].includes(delay), `unexpected delay ${delay}`);
        });
    });

    mocha.describe('reclaim_deleted_objects', function() {
        mocha.it('reclaims object deleted while restore was still ongoing', async function() {
            // Not picked by reclaim_expired_restores (requires live + ongoing:false).
            // Deleted+any restore_status is cleaned by reclaim_deleted_objects:
            // delete local restore mappings, then archive delete (idempotent if no
            // archive key), then mark reclaimed.
            const obj = await upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                restore_status: { ongoing: true },
                deleted: new Date(),
            });

            const res = await reclaimer.reclaim_deleted_objects();
            assert.ok(res.had_work, 'expected reclaim work for deleted+ongoing restore');
            assert.ok(!res.had_errors, 'reclaim should not error');

            const after = await MDStore.instance().find_object_by_id(obj._id);
            assert.ok(after.deleted, 'object remains soft-deleted');
            assert.ok(after.reclaimed, 'deleted+ongoing restore should be marked reclaimed');
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.strictEqual(parts.length, 0, 'local mappings should be deleted');
        });

        mocha.it('reclaims object deleted while transition source was still pending purge', async function() {
            // Not picked by reclaim_transition_source_data (requires live objects).
            // Deleted + unreclaimed source has no restore_status, so the restore
            // mapping path would skip local parts — this path must still purge them.
            const obj = await upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                transition_info: {
                    status: CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                    transition_end_ts: new Date(Date.now() - 60_000),
                    source_info: {
                        storage_class: 'STANDARD',
                    },
                },
                deleted: new Date(),
            });

            const res = await reclaimer.reclaim_deleted_objects();
            assert.ok(res.had_work, 'expected reclaim work for deleted+unreclaimed transition source');
            assert.ok(!res.had_errors, 'reclaim should not error');

            const after = await MDStore.instance().find_object_by_id(obj._id);
            assert.ok(after.deleted, 'object remains soft-deleted');
            assert.ok(after.reclaimed, 'deleted+unreclaimed transition source should be marked reclaimed');
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.strictEqual(parts.length, 0, 'local source mappings should be deleted');
        });
    });

    mocha.describe('delete_object_mappings_for_expired_restore_or_transition', function() {
        mocha.it('deletes uploaded object parts but keeps the object MD', async function() {
            const obj = await upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
            });
            await map_deleter.delete_object_mappings_for_expired_restore_or_transition(obj);
            const after = await assert_object_not_deleted(obj._id);
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.strictEqual(parts.length, 0);
        });

        mocha.it('is a no-op for objects with no parts', async function() {
            const obj = await upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
            });
            // First call removes parts; second call should be a safe no-op (idempotent).
            await map_deleter.delete_object_mappings_for_expired_restore_or_transition(obj);
            await map_deleter.delete_object_mappings_for_expired_restore_or_transition(obj);
            const after = await assert_object_not_deleted(obj._id);
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.strictEqual(parts.length, 0);
        });
    });

    // One second is long enough that phase A and phase B of a single call stay
    // inside the window, and short enough for the suite to wait it out.
    const CHUNK_DELETE_THRESHOLD_MS = 1000;

    mocha.describe('standard batch reclaim', function() {
        const saved_threshold = config.CHUNKS_DELETE_THRESHOLD;

        mocha.before(() => {
            config.CHUNKS_DELETE_THRESHOLD = CHUNK_DELETE_THRESHOLD_MS;
        });

        mocha.after(() => {
            config.CHUNKS_DELETE_THRESHOLD = saved_threshold;
        });

        mocha.beforeEach(async function() {
            await drain_unreclaimed_queue(reclaimer);
        });

        mocha.describe('soft_delete_mappings_of_objects', function() {
            mocha.it('soft-deletes parts and stamps pending_delete', async function() {
                const obj = await upload(200);
                const snap = await mapping_of(obj);
                await give_dedup_key(snap.chunk_ids, 'pending-stamp');
                await mark_deleted(obj);

                const phase_a = await MDStore.instance().soft_delete_mappings_of_objects([id_of(obj)]);

                assert.strictEqual(phase_a.parts, snap.parts.length);
                assert.strictEqual(phase_a.multiparts, 0);
                assert.strictEqual((await MDStore.instance().find_all_parts_of_object(obj)).length, 0);
                const rows = await part_rows(obj);
                assert.strictEqual(rows.length, snap.parts.length);
                for (const row of rows) assert.ok(row.deleted, 'part row stays, with deleted set');
                await assert_reclaimed(obj);

                const chunks = await chunks_of(snap.chunk_ids);
                assert_pending(chunks);
                assert_blocks_live(await blocks_of(snap.chunk_ids));
                assert_dedup_rejected(chunks[0]);
            });

            mocha.it('leaves a chunk that another live object still references', async function() {
                const source = await upload(200);
                const copy = await copy_of(source);
                const source_map = await mapping_of(source);
                const copy_map = await mapping_of(copy);
                assert.deepStrictEqual(chunk_id_strings(source_map), chunk_id_strings(copy_map));
                const dedup_key = Buffer.from('pending-shared');
                await MDStore.instance().update_chunks_by_ids(source_map.chunk_ids, { dedup_key });
                await mark_deleted(source);

                const phase_a = await MDStore.instance().soft_delete_mappings_of_objects([id_of(source)]);

                assert.strictEqual(phase_a.parts, source_map.parts.length);
                assert.strictEqual((await MDStore.instance().find_all_parts_of_object(source)).length, 0);
                assert.strictEqual(
                    (await MDStore.instance().find_all_parts_of_object(copy)).length,
                    copy_map.parts.length,
                );
                await assert_reclaimed(source);
                const chunks = await chunks_of(source_map.chunk_ids);
                assert.strictEqual(chunks.length, source_map.chunk_ids.length);
                for (const chunk of chunks) {
                    assert.ok(!chunk.deleted, 'shared chunk stays live');
                    assert.ok(!chunk.pending_delete, 'a live part blocks pending_delete');
                    assert.ok(chunk.dedup_key && chunk.dedup_key.equals(dedup_key));
                }
                assert_blocks_live(await blocks_of(source_map.chunk_ids));
            });

            mocha.it('soft-deletes multiparts and leaves the rows', async function() {
                const obj = await upload(200);
                await add_multipart(obj, 1);
                await add_multipart(obj, 2);
                await mark_deleted(obj);

                const phase_a = await MDStore.instance().soft_delete_mappings_of_objects([id_of(obj)]);

                assert.strictEqual(phase_a.multiparts, 2);
                assert.strictEqual((await MDStore.instance().find_all_multiparts_of_object(obj._id)).length, 0);
                const rows = await multipart_rows(obj);
                assert.strictEqual(rows.length, 2);
                for (const row of rows) assert.ok(row.deleted, 'multipart row stays, with deleted set');
                await assert_reclaimed(obj);
            });

            mocha.it('returns without writing when the id list is empty', async function() {
                const phase_a = await MDStore.instance().soft_delete_mappings_of_objects([]);
                assert.strictEqual(phase_a, undefined);
            });

            mocha.it('leaves a multipart that belongs to another object', async function() {
                const source = await upload(80);
                const other = await upload(80);
                await add_multipart(source, 1);
                await add_multipart(other, 1);
                await mark_deleted(source);

                const phase_a = await MDStore.instance().soft_delete_mappings_of_objects([id_of(source)]);

                assert.strictEqual(phase_a.multiparts, 1);
                const source_rows = await multipart_rows(source);
                assert.strictEqual(source_rows.length, 1);
                assert.ok(source_rows[0].deleted);
                const other_rows = await multipart_rows(other);
                assert.strictEqual(other_rows.length, 1);
                assert.ok(!other_rows[0].deleted, 'the other object multipart stays live');
                await assert_reclaimed(source);
            });
        });

        mocha.describe('reclaim_mappings_of_objects', function() {
            mocha.it('leaves chunks alone while their parts are still live', async function() {
                const obj = await upload(160);
                const snap = await mapping_of(obj);
                await give_dedup_key(snap.chunk_ids, 'phase-b-live-parts');
                await mark_deleted(obj);

                await MDStore.instance().reclaim_mappings_of_objects();

                assert.strictEqual((await MDStore.instance().find_all_parts_of_object(obj)).length, snap.parts.length);
                await assert_not_reclaimed(obj);
                const chunks = await chunks_of(snap.chunk_ids);
                assert.strictEqual(chunks.length, snap.chunk_ids.length);
                for (const chunk of chunks) {
                    assert.ok(!chunk.deleted);
                    assert.ok(!chunk.pending_delete);
                    assert.ok(chunk.dedup_key && chunk.dedup_key.equals(Buffer.from('phase-b-live-parts')));
                }
                assert_blocks_live(await blocks_of(snap.chunk_ids));
            });

            mocha.it('leaves a pending chunk inside the threshold and keeps the part rows', async function() {
                const obj = await upload(200);
                const snap = await mapping_of(obj);
                await give_dedup_key(snap.chunk_ids, 'inside-threshold');
                await mark_deleted(obj);
                await MDStore.instance().soft_delete_mappings_of_objects([id_of(obj)]);

                await MDStore.instance().reclaim_mappings_of_objects();

                assert.strictEqual((await part_rows(obj)).length, snap.parts.length);
                await assert_reclaimed(obj);
                assert_pending(await chunks_of(snap.chunk_ids));
                assert_blocks_live(await blocks_of(snap.chunk_ids));
            });

            mocha.it('soft-deletes an expired chunk and its blocks', async function() {
                const obj = await upload(200);
                const snap = await mapping_of(obj);
                await mark_deleted(obj);
                await MDStore.instance().soft_delete_mappings_of_objects([id_of(obj)]);
                assert_pending(await chunks_of(snap.chunk_ids));

                await wait_for_chunk_expiry();
                await MDStore.instance().reclaim_mappings_of_objects();

                assert_chunks_deleted(await chunks_of(snap.chunk_ids), snap.chunk_ids.length);
                assert_blocks_deleted(await blocks_of(snap.chunk_ids), snap.blocks.length);
                assert.strictEqual((await part_rows(obj)).length, snap.parts.length);
                await assert_reclaimed(obj);
            });

            mocha.it('leaves soft-deleted multipart rows in place', async function() {
                const obj = await upload(200);
                await add_multipart(obj, 1);
                await add_multipart(obj, 2);
                await mark_deleted(obj);
                await MDStore.instance().soft_delete_mappings_of_objects([id_of(obj)]);

                await MDStore.instance().reclaim_mappings_of_objects();

                const rows = await multipart_rows(obj);
                assert.strictEqual(rows.length, 2);
                for (const row of rows) assert.ok(row.deleted, 'multipart row stays, with deleted set');
                await assert_reclaimed(obj);
            });
        });

        mocha.describe('reclaim_deleted_objects', function() {
            mocha.it('reclaims the object and leaves the chunk pending', async function() {
                const obj = await upload(200);
                const snap = await mapping_of(obj);
                await mark_deleted(obj);

                const res = await reclaimer.reclaim_deleted_objects();

                assert.ok(res.had_work);
                assert.ok(!res.had_errors);
                await assert_reclaimed(obj);
                assert.strictEqual((await part_rows(obj)).length, snap.parts.length);
                assert_pending(await chunks_of(snap.chunk_ids));
                assert_blocks_live(await blocks_of(snap.chunk_ids));
            });

            mocha.it('soft-deletes an expired chunk when the unreclaimed queue is empty', async function() {
                const obj = await upload(200);
                const snap = await mapping_of(obj);
                await mark_deleted(obj);

                const first = await reclaimer.reclaim_deleted_objects();
                assert.ok(first.had_work);
                assert.ok(!first.had_errors);
                assert_pending(await chunks_of(snap.chunk_ids));

                await wait_for_chunk_expiry();
                const second = await reclaimer.reclaim_deleted_objects();

                assert.strictEqual(second.had_work, false);
                assert.ok(!second.had_errors);
                assert_chunks_deleted(await chunks_of(snap.chunk_ids), snap.chunk_ids.length);
                assert_blocks_deleted(await blocks_of(snap.chunk_ids), snap.blocks.length);
                assert.strictEqual((await part_rows(obj)).length, snap.parts.length);
            });

            mocha.it('soft-deletes an expired chunk while a later object is reclaimed', async function() {
                const first = await upload(200);
                const first_map = await mapping_of(first);
                await mark_deleted(first);

                const first_pass = await reclaimer.reclaim_deleted_objects();
                assert.ok(first_pass.had_work);
                assert.ok(!first_pass.had_errors);
                await assert_reclaimed(first);
                assert_pending(await chunks_of(first_map.chunk_ids));
                assert_blocks_live(await blocks_of(first_map.chunk_ids));

                await wait_for_chunk_expiry();
                const second = await upload(160);
                const second_map = await mapping_of(second);
                await mark_deleted(second);

                const second_pass = await reclaimer.reclaim_deleted_objects();
                assert.ok(second_pass.had_work);
                assert.ok(!second_pass.had_errors);
                await assert_reclaimed(second);
                assert_chunks_deleted(await chunks_of(first_map.chunk_ids), first_map.chunk_ids.length);
                assert_blocks_deleted(await blocks_of(first_map.chunk_ids), first_map.blocks.length);
                assert.strictEqual((await part_rows(first)).length, first_map.parts.length);
                assert_pending(await chunks_of(second_map.chunk_ids));
                assert_blocks_live(await blocks_of(second_map.chunk_ids));
            });
        });

        mocha.describe('db_cleaner parts', function() {
            mocha.it('hard-deletes part rows and the object row', async function() {
                const obj = await upload(200);
                const snap = await mapping_of(obj);
                await add_multipart(obj, 1);
                await mark_deleted(obj);
                await MDStore.instance().soft_delete_mappings_of_objects([id_of(obj)]);
                assert.strictEqual((await part_rows(obj)).length, snap.parts.length);
                assert.strictEqual((await multipart_rows(obj)).length, 1);

                await hard_delete_expired_rows();

                assert.strictEqual((await part_rows(obj)).length, 0);
                assert.strictEqual((await multipart_rows(obj)).length, 0);
                assert.ok(!(await MDStore.instance().find_object_by_id(obj._id)));
                assert_pending(await chunks_of(snap.chunk_ids));
            });
        });

        mocha.describe('s3 reclaim', function() {
            mocha.it('empties mapping tables after the chunk threshold', async function() {
                const s3 = await s3_client();
                const bucket = `reclaim-s3-${Date.now().toString(36)}`;
                const keys = ['file-a', 'file-b', 'file-c'];
                await s3.createBucket({ Bucket: bucket });
                try {
                    for (const key of keys) {
                        await s3.putObject({
                            Bucket: bucket,
                            Key: key,
                            Body: Buffer.alloc(200, 0x61),
                        });
                    }
                    await s3.deleteObjects({
                        Bucket: bucket,
                        Delete: { Objects: keys.map(Key => ({ Key })) },
                    });

                    const bucket_id = await bucket_id_by_name(bucket);
                    const first = await reclaimer.reclaim_deleted_objects();
                    assert.ok(first.had_work, 'reclaimer should pick up the deleted objects');
                    assert.ok(!first.had_errors);

                    const pending_chunks = await count_rows_for_bucket(bucket_id, 'datachunks', 'pending');
                    const live_blocks = await count_rows_for_bucket(bucket_id, 'datablocks', 'live');
                    assert.strictEqual(await count_rows_for_bucket(bucket_id, 'objectmds'), keys.length);
                    assert.ok(await count_rows_for_bucket(bucket_id, 'objectparts') > 0, 'part rows stay until db_cleaner');
                    assert.ok(pending_chunks > 0, 'phase A should leave pending chunks');
                    assert.ok(live_blocks > 0, 'blocks stay live until the chunk expires');

                    await wait_for_chunk_expiry();
                    // No unreclaimed objects left. The reclaimer still runs phase B,
                    // which soft-deletes chunks whose pending_delete has expired.
                    assert.strictEqual(
                        await count_rows_for_bucket(bucket_id, 'datachunks', 'deleted'),
                        0,
                        'chunks stay pending until the empty-queue pass',
                    );
                    const second = await reclaimer.reclaim_deleted_objects();
                    assert.strictEqual(second.had_work, false, 'empty unreclaimed queue still runs phase B');
                    assert.ok(!second.had_errors);
                    assert.strictEqual(await count_rows_for_bucket(bucket_id, 'datachunks', 'pending'), 0);
                    assert.strictEqual(
                        await count_rows_for_bucket(bucket_id, 'datachunks', 'deleted'),
                        pending_chunks,
                        'the empty-queue pass soft-deletes the pending chunks',
                    );
                    assert.strictEqual(
                        await count_rows_for_bucket(bucket_id, 'datablocks', 'deleted'),
                        live_blocks,
                        'the empty-queue pass soft-deletes the blocks of those chunks',
                    );
                    assert.ok(
                        await count_rows_for_bucket(bucket_id, 'objectparts') > 0,
                        'phase B leaves part rows for db_cleaner',
                    );

                    await hard_delete_expired_rows();

                    for (const table of ['objectmds', 'objectparts', 'datachunks', 'datablocks']) {
                        const count = await count_rows_for_bucket(bucket_id, table);
                        assert.strictEqual(count, 0, `${table} should be empty`);
                    }
                } finally {
                    try {
                        await s3.deleteObjects({
                            Bucket: bucket,
                            Delete: { Objects: keys.map(Key => ({ Key })) },
                        });
                    } catch (_err) {
                        // object delete is cleanup
                    }
                    try {
                        await s3.deleteBucket({ Bucket: bucket });
                    } catch (_err) {
                        // bucket delete is cleanup
                    }
                }
            });
        });
    });
});

const CHUNK_DELETE_THRESHOLD_MS_WAIT = 100;

async function s3_client() {
    const account = await rpc_client.account.read_account({ email: coretest.EMAIL });
    return new S3({
        endpoint: coretest.get_http_address(),
        credentials: {
            accessKeyId: account.access_keys[0].access_key.unwrap(),
            secretAccessKey: account.access_keys[0].secret_key.unwrap(),
        },
        forcePathStyle: true,
        region: config.DEFAULT_REGION,
        requestHandler: new NodeHttpHandler({
            httpAgent: http_utils.get_unsecured_agent(coretest.get_http_address()),
        }),
    });
}

async function bucket_id_by_name(name) {
    const res = await db_client.instance().executeSQL(
        `SELECT data->>'_id' AS id FROM buckets WHERE data->>'name' = $1`,
        [name],
        { preferred_pool: 'md' },
    );
    assert.strictEqual(res.rows.length, 1, `bucket ${name} should exist`);
    return /** @type {{ id: string }} */ (res.rows[0]).id;
}

// Keep the soft-deletes older than both cleaner cutoffs, and the cutoffs behind
// the aggregator cursor. db_cleaner skips a run when either side is wrong.
// pg_class.reltuples stays -1 until ANALYZE, and clean_md_store_parts skips when
// that estimate is below DB_CLEANER_MAX_TOTAL_DOCS, so the threshold has to be -1.
const CLEANER_WINDOW_MS = 3000;

async function hard_delete_expired_rows() {
    const saved = {
        back_time: config.DB_CLEANER_BACK_TIME,
        parts_back_time: config.DB_CLEANER_PARTS_BACK_TIME,
        cycle: config.DB_CLEANER_CYCLE,
        max_docs: config.DB_CLEANER_MAX_TOTAL_DOCS,
        grace: config.MD_GRACE_IN_MILLISECONDS,
        interval: config.MD_AGGREGATOR_INTERVAL,
        docs_limit: config.DB_CLEANER_DOCS_LIMIT
    };
    config.DB_CLEANER_CYCLE = 0;
    config.DB_CLEANER_MAX_TOTAL_DOCS = -1;
    config.MD_GRACE_IN_MILLISECONDS = 0;
    config.MD_AGGREGATOR_INTERVAL = 24 * 60 * 60 * 1000;
    config.DB_CLEANER_DOCS_LIMIT = Number.MAX_SAFE_INTEGER;
    try {
        await timer.setTimeout(CLEANER_WINDOW_MS);
        await md_aggregator.background_worker();
        // Blocks are hard-deleted only after data.reclaimed is set. Chunks stay
        // while any block row for that chunk remains.
        await reclaim_deleted_blocks();
        const cursor = system_store_mod.get_instance().data.systems[0].global_last_update;
        assert.ok(cursor, 'md aggregator should advance global_last_update');
        const age = (Date.now() - cursor) + Math.floor(CLEANER_WINDOW_MS / 2);
        config.DB_CLEANER_BACK_TIME = age;
        config.DB_CLEANER_PARTS_BACK_TIME = age;
        await db_cleaner.background_worker();
    } finally {
        config.DB_CLEANER_BACK_TIME = saved.back_time;
        config.DB_CLEANER_PARTS_BACK_TIME = saved.parts_back_time;
        config.DB_CLEANER_CYCLE = saved.cycle;
        config.DB_CLEANER_MAX_TOTAL_DOCS = saved.max_docs;
        config.MD_GRACE_IN_MILLISECONDS = saved.grace;
        config.MD_AGGREGATOR_INTERVAL = saved.interval;
        config.DB_CLEANER_DOCS_LIMIT = saved.docs_limit;
    }
}

async function reclaim_deleted_blocks() {
    const agent = new AgentBlocksReclaimer('s3-reclaim-test');
    for (let i = 0; i < 10; i++) {
        const delay = await agent.run_batch();
        if (delay === config.AGENT_BLOCKS_RECLAIMER_ERROR_DELAY) {
            throw new Error('agent blocks reclaimer failed');
        }
        // An orphan-only page sets marker and returns no delay. Keep scanning
        // until the restart delay or a page that clears the marker.
        if (delay === config.AGENT_BLOCKS_RECLAIMER_RESTART_DELAY || !agent.marker) return;
    }
    throw new Error('agent blocks reclaimer did not finish scanning');
}

/**
 * @param {string} bucket_id
 * @param {string} table
 * @param {'live' | 'pending' | 'deleted'} [state]
 */
async function count_rows_for_bucket(bucket_id, table, state) {
    const filters = {
        live: `AND (data->'deleted' IS NULL OR data->'deleted' = 'null'::jsonb)`,
        pending: `AND data->>'pending_delete' IS NOT NULL` +
            ` AND (data->'deleted' IS NULL OR data->'deleted' = 'null'::jsonb)`,
        deleted: `AND data ? 'deleted' AND data->>'deleted' IS NOT NULL`,
    };
    const state_sql = state ? filters[state] : '';
    const res = await db_client.instance().executeSQL(
        `SELECT count(*)::int AS n FROM ${table} WHERE data->>'bucket' = $1 ${state_sql}`,
        [bucket_id],
        { preferred_pool: 'md' },
    );
    return /** @type {{ n: number }} */ (res.rows[0]).n;
}

async function drain_unreclaimed_queue(objects_reclaimer) {
    for (let i = 0; i < 20; i++) {
        const res = await objects_reclaimer.reclaim_deleted_objects();
        if (!res.had_work) break;
    }
    for (let i = 0; i < 1000; i++) {
        const leftovers = await MDStore.instance().find_unreclaimed_objects(1000);
        if (!leftovers.length) break;
        await MDStore.instance().update_objects_by_ids(
            leftovers.map(obj => obj._id),
            { reclaimed: new Date() },
        );
    }
}

function unique_key() {
    return `reclaim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function upload(size) {
    const key = unique_key();
    const params = {
        client: rpc_client,
        bucket: STD_BUCKET,
        key,
        size,
        content_type: 'application/octet-stream',
        source_stream: buffer_utils.buffer_to_read_stream(Buffer.alloc(size, 0x61)),
    };
    await object_io.upload_object(params);
    return MDStore.instance().find_object_by_id(MDStore.instance().make_md_id(params.obj_id));
}

async function copy_of(source) {
    const key = unique_key();
    await object_io.upload_object({
        client: rpc_client,
        bucket: STD_BUCKET,
        key,
        copy_source: {
            bucket: STD_BUCKET,
            key: source.key,
            obj_id: String(source._id),
        },
    });
    const md = await rpc_client.object.read_object_md({ bucket: STD_BUCKET, key });
    return MDStore.instance().find_object_by_id(MDStore.instance().make_md_id(md.obj_id));
}

async function mark_deleted(obj) {
    await MDStore.instance().update_object_by_id(obj._id, { deleted: new Date() });
    return MDStore.instance().find_object_by_id(obj._id);
}

function id_of(obj) {
    return String(obj._id);
}

async function give_dedup_key(chunk_ids, label) {
    await MDStore.instance().update_chunks_by_ids(chunk_ids, { dedup_key: Buffer.from(label) });
}

async function mapping_of(obj) {
    const parts = await MDStore.instance().find_all_parts_of_object(obj);
    const chunk_ids = [];
    const seen = new Set();
    for (const part of parts) {
        if (!part.chunk) continue;
        const id = String(part.chunk);
        if (seen.has(id)) continue;
        seen.add(id);
        chunk_ids.push(part.chunk);
    }
    return {
        parts,
        chunk_ids,
        chunks: await chunks_of(chunk_ids),
        blocks: await blocks_of(chunk_ids),
    };
}

function chunk_id_strings(snap) {
    return snap.chunk_ids.map(id => String(id)).sort();
}

async function chunks_of(chunk_ids) {
    if (!chunk_ids.length) return [];
    return (await MDStore.instance().find_chunks_by_ids(chunk_ids)) || [];
}

async function blocks_of(chunk_ids) {
    if (!chunk_ids.length) return [];
    return (await MDStore.instance().find_blocks_of_chunks(chunk_ids)) || [];
}

async function part_rows(obj) {
    return MDStore.instance()._parts.find({
        obj: { $eq: obj._id, $exists: true },
    });
}

async function add_multipart(obj, num) {
    await MDStore.instance().insert_multipart({
        _id: MDStore.instance().make_md_id(),
        system: obj.system,
        bucket: obj.bucket,
        obj: obj._id,
        num,
        size: 10,
        create_time: new Date(),
    });
}

async function multipart_rows(obj) {
    return MDStore.instance()._multiparts.find({
        obj: { $eq: obj._id, $exists: true },
    });
}

async function wait_for_chunk_expiry() {
    await timer.setTimeout(config.CHUNKS_DELETE_THRESHOLD + CHUNK_DELETE_THRESHOLD_MS_WAIT);
}

function is_date(value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
}

async function assert_reclaimed(obj) {
    const after = await MDStore.instance().find_object_by_id(obj._id);
    assert.ok(after.deleted, `${obj.key} stays soft-deleted`);
    assert.ok(is_date(after.reclaimed), `${obj.key} is reclaimed`);
}

async function assert_not_reclaimed(obj) {
    const after = await MDStore.instance().find_object_by_id(obj._id);
    assert.ok(after.deleted, `${obj.key} stays soft-deleted`);
    assert.ok(!after.reclaimed, `${obj.key} is not reclaimed`);
}

function assert_pending(chunks) {
    assert.ok(chunks.length >= 1);
    for (const chunk of chunks) {
        assert.ok(!chunk.deleted, 'chunk stays live while pending_delete is set');
        assert.ok(!chunk.dedup_key, 'pending_delete clears dedup_key');
        assert.ok(Number.isFinite(chunk.pending_delete) && chunk.pending_delete > 0);
    }
}

function assert_chunks_deleted(chunks, expected_count) {
    assert.strictEqual(chunks.length, expected_count, 'every chunk row is still present');
    for (const chunk of chunks) {
        assert.ok(is_date(chunk.deleted), 'chunk is soft-deleted');
        assert.ok(!chunk.dedup_key);
    }
}

function assert_blocks_live(blocks) {
    assert.ok(blocks.length > 0, 'expected blocks');
    for (const block of blocks) assert.ok(!block.deleted, 'block stays live');
}

function assert_blocks_deleted(blocks, expected_count) {
    assert.strictEqual(blocks.length, expected_count, 'every block row is still present');
    for (const block of blocks) assert.ok(is_date(block.deleted), 'block is soft-deleted');
}

function assert_dedup_rejected(chunk_db) {
    const saved_age = config.MIN_CHUNK_AGE_FOR_DEDUP;
    config.MIN_CHUNK_AGE_FOR_DEDUP = 0;
    try {
        const pending = new ChunkDB(chunk_db);
        pending.is_accessible = true;
        assert.strictEqual(mapper.is_chunk_good_for_dedup(pending), false);
        const eligible_db = { ...chunk_db };
        delete eligible_db.pending_delete;
        const eligible = new ChunkDB(eligible_db);
        eligible.is_accessible = true;
        assert.strictEqual(mapper.is_chunk_good_for_dedup(eligible), true);
    } finally {
        config.MIN_CHUNK_AGE_FOR_DEDUP = saved_age;
    }
}
