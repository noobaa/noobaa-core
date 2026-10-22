/* Copyright (C) 2016 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
const { setup, rpc_client, POOL_LIST } = coretest;
setup({ pools_to_create: [POOL_LIST[1]] });

const mocha = require('mocha');
const assert = require('assert');

const config = require('../../../../config');
const CONSTANTS = require('../../../common/constants');
const buffer_utils = require('../../../util/buffer_utils');
const ObjectIO = require('../../../sdk/object_io');
const { ObjectsReclaimer } = require('../../../server/bg_services/objects_reclaimer');
const { MDStore } = require('../../../server/object_services/md_store');
const map_deleter = require('../../../server/object_services/map_deleter');
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

    mocha.describe('standard object batch', function() {
        this.timeout(180000); // eslint-disable-line no-invalid-this

        mocha.beforeEach(async function() {
            await drain_unreclaimed_queue(reclaimer);
        });

        mocha.it('reclaims objects of different sizes in one call', async function() {
            const empty = await complete_empty(STD_BUCKET);
            const small = await upload_standard(STD_BUCKET, 16);
            const large = await upload_standard(STD_BUCKET, 700);
            const multipart = await complete_multipart(STD_BUCKET, [40, 100, 220]);
            const live = await upload_standard(STD_BUCKET, 80);

            const small_map = await snapshot_mappings(small);
            const large_map = await snapshot_mappings(large);
            const multipart_map = await snapshot_mappings(multipart);
            const live_map = await snapshot_mappings(live);
            assert.strictEqual((await snapshot_mappings(empty)).parts.length, 0);
            assert.strictEqual(small_map.parts.length, 1, '16 bytes is one chunk');
            assert.ok(large_map.parts.length > small_map.parts.length, '700 bytes splits into several chunks');
            assert.ok(multipart_map.parts.length >= 3, 'multipart object keeps a part per uploaded part');
            assert.strictEqual(multipart_map.multiparts.length, 3);
            assert.ok(live_map.blocks.length > 0);

            const deleted = await Promise.all([empty, small, large, multipart].map(soft_delete));
            const calls = await reclaim_watching_batch(reclaimer);
            assert.strictEqual(calls.length, 1, 'standard objects are reclaimed in one batch');
            const batched = calls[0].slice().sort();
            for (const obj of deleted) {
                assert.ok(batched.includes(String(obj._id)), `batch should include ${obj.key}`);
            }
            assert.ok(!batched.includes(String(live._id)), 'a live object is not part of the batch');

            for (const obj of deleted) {
                await assert_object_reclaimed(obj);
            }
            await assert_mappings_removed(small_map);
            await assert_mappings_removed(large_map);
            await assert_mappings_removed(multipart_map);
            await assert_mappings_kept(live_map);

            const again = await reclaimer.reclaim_deleted_objects();
            assert.ok(!again.had_work, 'a second pass has nothing left to reclaim');
        });

        mocha.it('reclaims aborted uploads and aborted multipart uploads in one call', async function() {
            const aborted = await abort_simple_upload(STD_BUCKET, 180);
            const aborted_mpu = await abort_multipart(STD_BUCKET, [50, 160, 300]);
            const completed = await soft_delete(await upload_standard(STD_BUCKET, 32));

            const aborted_map = await snapshot_mappings(aborted);
            const aborted_mpu_map = await snapshot_mappings(aborted_mpu);
            const completed_map = await snapshot_mappings(completed);
            assert.ok(aborted.deleted && !aborted.reclaimed);
            assert.ok(aborted_map.parts.length >= 1);
            assert.strictEqual(aborted_map.multiparts.length, 0, 'a simple abort has no multipart rows');
            assert.ok(aborted_mpu.deleted && !aborted_mpu.reclaimed);
            assert.ok(aborted_mpu_map.parts.length >= 3);
            assert.strictEqual(aborted_mpu_map.multiparts.length, 3);
            assert.ok(aborted_map.blocks.length > 0);
            assert.ok(aborted_mpu_map.blocks.length > 0);

            const calls = await reclaim_watching_batch(reclaimer);
            assert.strictEqual(calls.length, 1);
            const batched = calls[0];
            for (const obj of [aborted, aborted_mpu, completed]) {
                assert.ok(batched.includes(String(obj._id)));
                await assert_object_reclaimed(obj);
            }
            await assert_mappings_removed(aborted_map);
            await assert_mappings_removed(aborted_mpu_map);
            await assert_mappings_removed(completed_map);
        });

        mocha.it('keeps a deduped chunk that a live object still references', async function() {
            const source = await upload_standard(STD_BUCKET, 200);
            const copy = await copy_standard(STD_BUCKET, source);
            const source_map = await snapshot_mappings(source);
            const copy_map = await snapshot_mappings(copy);
            assert.deepStrictEqual(chunk_id_strings(source_map), chunk_id_strings(copy_map));
            assert.ok(source_map.chunks.length >= 1);
            const dedup_key = Buffer.from('dedup-live-copy');
            await MDStore.instance().update_chunks_by_ids(source_map.chunk_ids, { dedup_key });

            await soft_delete(source);
            await reclaim_watching_batch(reclaimer);

            await assert_object_reclaimed(source);
            const source_parts = await MDStore.instance().find_all_parts_of_object(source);
            assert.strictEqual(source_parts.length, 0);
            await assert_mappings_kept(copy_map);
            const chunks = await load_chunks(source_map.chunk_ids);
            for (const chunk of chunks) {
                assert.ok(!chunk.deleted, 'shared chunk stays while the copy is live');
                assert.ok(chunk.dedup_key && chunk.dedup_key.equals(dedup_key));
            }
            const blocks = await load_blocks(source_map.chunk_ids);
            for (const block of blocks) {
                assert.ok(!block.deleted, 'blocks of a shared chunk stay');
            }
        });

        mocha.it('deletes a deduped chunk when every referencing object is in the batch', async function() {
            const source = await upload_standard(STD_BUCKET, 220);
            const copy = await copy_standard(STD_BUCKET, source);
            const source_map = await snapshot_mappings(source);
            const copy_map = await snapshot_mappings(copy);
            assert.deepStrictEqual(chunk_id_strings(source_map), chunk_id_strings(copy_map));
            const dedup_key = Buffer.from('dedup-both-deleted');
            await MDStore.instance().update_chunks_by_ids(source_map.chunk_ids, { dedup_key });

            await soft_delete(source);
            await soft_delete(copy);
            const calls = await reclaim_watching_batch(reclaimer);
            assert.strictEqual(calls.length, 1);
            assert.ok(calls[0].includes(String(source._id)));
            assert.ok(calls[0].includes(String(copy._id)));

            await assert_object_reclaimed(source);
            await assert_object_reclaimed(copy);
            await assert_mappings_removed(source_map);
        });

        mocha.it('deletes a deduped chunk when the only other parts are already soft-deleted', async function() {
            const source = await upload_standard(STD_BUCKET, 180);
            const copy = await copy_standard(STD_BUCKET, source);
            const source_map = await snapshot_mappings(source);
            const copy_map = await snapshot_mappings(copy);
            assert.deepStrictEqual(
                chunk_id_strings(source_map),
                chunk_id_strings(copy_map),
            );
            const dedup_key = Buffer.from('dedup-soft-deleted-parts');
            await MDStore.instance().update_chunks_by_ids(source_map.chunk_ids, { dedup_key });

            // The copy is still live, but its parts no longer count as references.
            await MDStore.instance().delete_parts_of_object(copy);
            await soft_delete(source);
            await reclaim_watching_batch(reclaimer);

            await assert_object_reclaimed(source);
            const copy_after = await MDStore.instance().find_object_by_id(copy._id);
            assert.ok(!copy_after.deleted, 'the copy object itself stays');
            await assert_mappings_removed(source_map);

            await soft_delete(copy);
            await reclaim_watching_batch(reclaimer);
            await assert_object_reclaimed(copy);
            await assert_mappings_removed(copy_map);
        });

    });
});

///////////////////
// TEST HELPERS  //
///////////////////

/**
 * Empty the global unreclaimed deleted-object queue so single-batch reclaim
 * assertions are not racing a CI backlog.
 * Prefer ObjectsReclaimer for a bounded number of batches; force-mark leftovers
 * that cannot reclaim (e.g. DEEP_ARCHIVE whose archive ns is already gone) so
 * they stop filling every find_unreclaimed_objects batch.
 * @param {InstanceType<typeof ObjectsReclaimer>} objects_reclaimer
 */
async function drain_unreclaimed_queue(objects_reclaimer) {
    for (let i = 0; i < 20; i++) {
        const res = await objects_reclaimer.reclaim_deleted_objects();
        if (!res.had_work) break;
    }
    for (let i = 0; i < 1000; i++) {
        const leftovers = await MDStore.instance().find_unreclaimed_objects(1000);
        if (!leftovers.length) break;
        await MDStore.instance().update_objects_by_ids(
            leftovers.map(o => o._id),
            { reclaimed: new Date() },
        );
    }
}

function unique_key(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function upload_standard(bucket, size) {
    const key = unique_key('std');
    const params = {
        client: rpc_client,
        bucket,
        key,
        size,
        content_type: 'application/octet-stream',
        source_stream: buffer_utils.buffer_to_read_stream(Buffer.alloc(size, 0x61)),
    };
    await object_io.upload_object(params);
    return MDStore.instance().find_object_by_id(MDStore.instance().make_md_id(params.obj_id));
}

async function complete_empty(bucket) {
    const key = unique_key('empty');
    const content_type = 'application/octet-stream';
    const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key, content_type });
    await rpc_client.object.complete_object_upload({ obj_id, bucket, key });
    return MDStore.instance().find_object_by_id(MDStore.instance().make_md_id(obj_id));
}

async function complete_multipart(bucket, part_sizes) {
    const key = unique_key('mpu');
    const content_type = 'application/octet-stream';
    const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key, content_type });
    const replies = [];
    for (let i = 0; i < part_sizes.length; i++) {
        const size = part_sizes[i];
        const mp = await object_io.upload_multipart({
            client: rpc_client,
            obj_id,
            bucket,
            key,
            num: i + 1,
            size,
            source_stream: buffer_utils.buffer_to_read_stream(Buffer.alloc(size, 0x42 + i)),
        });
        replies.push(mp);
    }
    await rpc_client.object.complete_object_upload({
        obj_id,
        bucket,
        key,
        multiparts: replies.map((mp, i) => ({ num: i + 1, etag: mp.etag })),
    });
    return MDStore.instance().find_object_by_id(MDStore.instance().make_md_id(obj_id));
}

async function abort_simple_upload(bucket, size) {
    const key = unique_key('abort');
    const params = {
        client: rpc_client,
        bucket,
        key,
        size,
        content_type: 'application/octet-stream',
        source_stream: buffer_utils.buffer_to_read_stream(Buffer.alloc(size, 0x71)),
    };
    const create_reply = await rpc_client.object.create_object_upload({
        bucket,
        key,
        content_type: params.content_type,
        size,
    });
    params.obj_id = create_reply.obj_id;
    params.tier_id = create_reply.tier_id;
    params.bucket_id = create_reply.bucket_id;
    params.chunk_split_config = create_reply.chunk_split_config;
    params.chunk_coder_config = create_reply.chunk_coder_config;
    params.bucket_master_key_id = create_reply.bucket_master_key_id;
    await object_io._upload_stream(params, { obj_id: create_reply.obj_id, bucket, key });
    await rpc_client.object.abort_object_upload({ bucket, key, obj_id: create_reply.obj_id });
    return MDStore.instance().find_object_by_id(MDStore.instance().make_md_id(create_reply.obj_id));
}

async function abort_multipart(bucket, part_sizes) {
    const key = unique_key('abort-mpu');
    const content_type = 'application/octet-stream';
    const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key, content_type });
    for (let i = 0; i < part_sizes.length; i++) {
        const size = part_sizes[i];
        await object_io.upload_multipart({
            client: rpc_client,
            obj_id,
            bucket,
            key,
            num: i + 1,
            size,
            source_stream: buffer_utils.buffer_to_read_stream(Buffer.alloc(size, 0x51 + i)),
        });
    }
    await rpc_client.object.abort_object_upload({ bucket, key, obj_id });
    return MDStore.instance().find_object_by_id(MDStore.instance().make_md_id(obj_id));
}

async function copy_standard(bucket, source) {
    const key = unique_key('copy');
    await object_io.upload_object({
        client: rpc_client,
        bucket,
        key,
        copy_source: {
            bucket,
            key: source.key,
            obj_id: String(source._id),
        },
    });
    const md = await rpc_client.object.read_object_md({ bucket, key });
    return MDStore.instance().find_object_by_id(MDStore.instance().make_md_id(md.obj_id));
}

async function soft_delete(obj) {
    await MDStore.instance().update_object_by_id(obj._id, { deleted: new Date() });
    return MDStore.instance().find_object_by_id(obj._id);
}

async function load_chunks(chunk_ids) {
    if (!chunk_ids.length) return [];
    return (await MDStore.instance().find_chunks_by_ids(chunk_ids)) || [];
}

async function load_blocks(chunk_ids) {
    if (!chunk_ids.length) return [];
    return (await MDStore.instance().find_blocks_of_chunks(chunk_ids)) || [];
}

async function snapshot_mappings(obj) {
    const fresh = await MDStore.instance().find_object_by_id(obj._id);
    const parts = await MDStore.instance().find_all_parts_of_object(fresh);
    const multiparts = await MDStore.instance().find_all_multiparts_of_object(fresh._id);
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
        multiparts,
        chunk_ids,
        chunks: await load_chunks(chunk_ids),
        blocks: await load_blocks(chunk_ids),
    };
}

function chunk_id_strings(snap) {
    return snap.chunk_ids.map(id => String(id)).sort();
}

/**
 * Run one reclaim and record the id list passed to the batch deleter.
 * @param {InstanceType<typeof ObjectsReclaimer>} objects_reclaimer
 * @returns {Promise<string[][]>}
 */
async function reclaim_watching_batch(objects_reclaimer) {
    const calls = [];
    const original = map_deleter.delete_mapping_batch;
    map_deleter.delete_mapping_batch = async objs => {
        calls.push(objs.slice());
        return original(objs);
    };
    try {
        const res = await objects_reclaimer.reclaim_deleted_objects();
        assert.ok(res.had_work, 'expected reclaim work');
        assert.ok(!res.had_errors, 'reclaim should not error');
        return calls;
    } finally {
        map_deleter.delete_mapping_batch = original;
    }
}

async function assert_object_reclaimed(obj) {
    const after = await MDStore.instance().find_object_by_id(obj._id);
    assert.ok(after, `${obj.key} still has object MD`);
    assert.ok(after.deleted, `${obj.key} stays soft-deleted`);
    assert.ok(
        after.reclaimed instanceof Date && !Number.isNaN(after.reclaimed.getTime()),
        `${obj.key} is marked reclaimed`,
    );
    const parts = await MDStore.instance().find_all_parts_of_object(after);
    assert.strictEqual(parts.length, 0, `${obj.key} parts removed`);
    const multiparts = await MDStore.instance().find_all_multiparts_of_object(after._id);
    assert.strictEqual(multiparts.length, 0, `${obj.key} multiparts removed`);
}

async function assert_mappings_removed(snap) {
    if (!snap.chunk_ids.length) return;
    const chunks = await load_chunks(snap.chunk_ids);
    assert.strictEqual(chunks.length, snap.chunk_ids.length);
    for (const chunk of chunks) {
        assert.ok(chunk.deleted instanceof Date && !Number.isNaN(chunk.deleted.getTime()), 'chunk soft-deleted');
        assert.ok(!chunk.dedup_key, 'dedup_key cleared on a deleted chunk');
    }
    const blocks = await load_blocks(snap.chunk_ids);
    assert.strictEqual(blocks.length, snap.blocks.length);
    assert.ok(blocks.length > 0, 'expected blocks to soft-delete');
    for (const block of blocks) {
        assert.ok(block.deleted instanceof Date && !Number.isNaN(block.deleted.getTime()), 'block soft-deleted');
    }
}

async function assert_mappings_kept(snap) {
    const chunks = await load_chunks(snap.chunk_ids);
    assert.strictEqual(chunks.length, snap.chunk_ids.length);
    for (const chunk of chunks) {
        assert.ok(!chunk.deleted, 'chunk stays while it is still referenced');
    }
    const blocks = await load_blocks(snap.chunk_ids);
    assert.strictEqual(blocks.length, snap.blocks.length);
    for (const block of blocks) {
        assert.ok(!block.deleted, 'block stays with its chunk');
    }
    if (snap.parts.length) {
        const parts = await MDStore.instance().find_all_parts_of_object({ _id: snap.parts[0].obj });
        assert.strictEqual(parts.length, snap.parts.length);
    }
}

