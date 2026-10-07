/* Copyright (C) 2026 NooBaa */
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
const { LifecycleReclaimer } = require('../../../server/bg_services/lifecycle_reclaimer');
const { MDStore } = require('../../../server/object_services/md_store');
const {
    create_archive_bucket,
    delete_archive_bucket,
    upload_and_patch,
    assert_object_not_deleted,
} = require('../../utils/reclaimers_test_utils');

const object_io = new ObjectIO();
object_io.set_verification_mode();

const BUCKET = 'test-lifecycle-reclaimer';
const ARCHIVE_NAMES = {
    bucket: BUCKET,
    archive_target_bucket: 'test-lifecycle-reclaimer-archive-target',
    archive_connection: 'lifecycle_reclaimer_archive_connection',
    archive_nsr: 'lifecycle_reclaimer_archive_nsr',
};

mocha.describe('LifecycleReclaimer', function() {
    this.timeout(120000); // eslint-disable-line no-invalid-this

    /** @type {InstanceType<typeof LifecycleReclaimer>} */
    let lifecycle_reclaimer;

    mocha.before(async function() {
        this.timeout(300000); // eslint-disable-line no-invalid-this
        await create_archive_bucket(ARCHIVE_NAMES);
        lifecycle_reclaimer = new LifecycleReclaimer({ name: 'test_lifecycle_reclaimer' });
    });

    mocha.after(async function() {
        await delete_archive_bucket(ARCHIVE_NAMES);
    });

    mocha.describe('reclaim_expired_restores', function() {
        mocha.it('leaves non-expired restore_status untouched', async function() {
            const obj = await upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date(Date.now() + 24 * 3600_000),
                },
            });

            const res = await lifecycle_reclaimer.reclaim_expired_restores();
            assert.ok(!res.had_work, 'non-expired restore should not produce reclaim work');
            assert.ok(!res.had_errors, 'reclaim should not error');

            const after = await assert_object_not_deleted(obj._id);
            assert.ok(after.restore_status, 'non-expired restore_status must remain');
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.ok(parts.length > 0, 'non-expired restore mappings must remain');
        });

        mocha.it('deletes local restore mappings and unsets restore_status without deleting the object', async function() {
            const obj = await upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date(Date.now() - 60_000),
                },
            });

            const res = await lifecycle_reclaimer.reclaim_expired_restores();
            assert.ok(res.had_work, 'expected reclaim work for expired restore');
            assert.ok(!res.had_errors, 'reclaim should not error');

            const after = await assert_object_not_deleted(obj._id);
            assert.ok(!after.restore_status, 'restore_status should be unset after expiry reclaim');
            assert.strictEqual(after.storage_class, CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                'object remains DEEP_ARCHIVE after reclaiming the STANDARD restore copy');
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.strictEqual(parts.length, 0, 'local restore parts should be deleted');
        });

        mocha.it('on MPU deletes STANDARD multiparts only and keeps deep-archive multiparts', async function() {
            // Setup: completed MPU (STANDARD parts + multiparts) plus an extra MD-only
            // deep-archive multipart with no local parts (simulates archive addressability).
            const { obj, standard_mp_ids, archive_mp_id } = await multipart_upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date(Date.now() - 60_000),
                },
            });

            const res = await lifecycle_reclaimer.reclaim_expired_restores();
            assert.ok(res.had_work, 'expected reclaim work for expired restore MPU');
            assert.ok(!res.had_errors, 'reclaim should not error');

            // Object stays live; only the temporary STANDARD restore copy is purged.
            const after = await assert_object_not_deleted(obj._id);
            assert.ok(!after.restore_status, 'restore_status should be unset after expiry reclaim');
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.strictEqual(parts.length, 0, 'STANDARD restore parts should be deleted');

            // Selective multipart cleanup: multiparts referenced by deleted parts are
            // soft-deleted; MD-only archive multiparts must remain live.
            const live_multiparts = await MDStore.instance().find_all_multiparts_of_object(obj._id);
            assert.strictEqual(live_multiparts.length, 1, 'only the archive MD-only multipart should remain live');
            assert.strictEqual(String(live_multiparts[0]._id), String(archive_mp_id));

            for (const mp_id of standard_mp_ids) {
                const mp = await MDStore.instance()._multiparts.findOne({
                    _id: MDStore.instance().make_md_id(mp_id),
                });
                assert.ok(mp, 'STANDARD multipart row should still exist');
                assert.ok(mp.deleted, 'STANDARD multipart referenced by parts must be soft-deleted');
            }

            const archive_mp = await MDStore.instance().find_multipart_by_id(archive_mp_id);
            assert.ok(archive_mp, 'deep-archive multipart must remain addressable');
            assert.ok(!archive_mp.deleted, 'deep-archive multipart must not be deleted');
        });

        mocha.it('reports an error when the expired-restore query fails', async function() {
            const md = MDStore.instance();
            const original = md.find_expired_restore_objects;
            md.find_expired_restore_objects = async () => {
                throw new Error('db down');
            };
            try {
                assert.deepStrictEqual(
                    await lifecycle_reclaimer.reclaim_expired_restores(),
                    { had_work: false, had_errors: true },
                );
            } finally {
                md.find_expired_restore_objects = original;
            }
        });
    });

    mocha.describe('reclaim_transition_source_data', function() {
        mocha.it('deletes source mappings and sets reclaimed without deleting the object', async function() {
            const obj = await upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                transition_info: {
                    status: CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                    transition_end_ts: new Date(Date.now() - 60_000),
                    source_info: {
                        storage_class: 'STANDARD',
                    },
                },
            });

            const res = await lifecycle_reclaimer.reclaim_transition_source_data();
            assert.ok(res.had_work, 'expected reclaim work for transition source data');
            assert.ok(!res.had_errors, 'reclaim should not error');

            const after = await assert_object_not_deleted(obj._id);
            assert.strictEqual(after.transition_info.status, CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE);
            assert.ok(after.transition_info.source_info.reclaimed,
                'source_info.reclaimed should be set');
            assert.strictEqual(after.storage_class, CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                'object remains DEEP_ARCHIVE after reclaiming the source STANDARD copy');
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.strictEqual(parts.length, 0, 'source-class parts should be deleted');
        });

        mocha.it('on MPU deletes STANDARD multiparts only and keeps deep-archive multiparts', async function() {
            // Setup: completed MPU (STANDARD parts + multiparts) plus an extra MD-only
            // deep-archive multipart with no local parts (simulates archive addressability).
            const { obj, standard_mp_ids, archive_mp_id } = await multipart_upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                transition_info: {
                    status: CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                    transition_end_ts: new Date(Date.now() - 60_000),
                    source_info: {
                        storage_class: 'STANDARD',
                    },
                },
            });

            const res = await lifecycle_reclaimer.reclaim_transition_source_data();
            assert.ok(res.had_work, 'expected reclaim work for transition source MPU');
            assert.ok(!res.had_errors, 'reclaim should not error');

            // Object stays live as DEEP_ARCHIVE; only the leftover STANDARD source copy is purged.
            const after = await assert_object_not_deleted(obj._id);
            assert.ok(after.transition_info.source_info.reclaimed);
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.strictEqual(parts.length, 0, 'STANDARD source parts should be deleted');

            // Selective multipart cleanup: multiparts referenced by deleted parts are
            // soft-deleted; MD-only archive multiparts must remain live.
            const live_multiparts = await MDStore.instance().find_all_multiparts_of_object(obj._id);
            assert.strictEqual(live_multiparts.length, 1, 'only the archive MD-only multipart should remain live');
            assert.strictEqual(String(live_multiparts[0]._id), String(archive_mp_id));

            for (const mp_id of standard_mp_ids) {
                const mp = await MDStore.instance()._multiparts.findOne({
                    _id: MDStore.instance().make_md_id(mp_id),
                });
                assert.ok(mp.deleted, 'STANDARD multipart referenced by parts must be soft-deleted');
            }

            const archive_mp = await MDStore.instance().find_multipart_by_id(archive_mp_id);
            assert.ok(!archive_mp.deleted, 'deep-archive multipart must not be deleted');
        });

        mocha.it('does not reclaim when restore_status is set', async function() {
            const obj = await upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date(Date.now() + 60 * 60_000),
                },
                transition_info: {
                    status: CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                    transition_end_ts: new Date(Date.now() - 60_000),
                    source_info: {
                        storage_class: 'STANDARD',
                    },
                },
            });
            const parts_before = await MDStore.instance().find_all_parts_of_object(obj);

            await lifecycle_reclaimer.reclaim_transition_source_data();

            const after = await assert_object_not_deleted(obj._id);
            assert.ok(after.restore_status, 'restore_status should remain');
            assert.ok(!after.transition_info.source_info.reclaimed,
                'transition reclaim must not run while restore_status is set');
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.strictEqual(parts.length, parts_before.length,
                'restore/local parts must not be wiped');
        });

        mocha.it('reports an error when the transition-source query fails', async function() {
            const md = MDStore.instance();
            const original = md.find_objects_with_transition_done_unreclaimed_source;
            md.find_objects_with_transition_done_unreclaimed_source = async () => {
                throw new Error('db down');
            };
            try {
                assert.deepStrictEqual(
                    await lifecycle_reclaimer.reclaim_transition_source_data(),
                    { had_work: false, had_errors: true },
                );
            } finally {
                md.find_objects_with_transition_done_unreclaimed_source = original;
            }
        });
    });

    mocha.describe('run_batch', function() {
        mocha.it('returns the batch delay when a reclaimer has work', async function() {
            const original_expired_restores = lifecycle_reclaimer.reclaim_expired_restores;
            const original_transition_source = lifecycle_reclaimer.reclaim_transition_source_data;
            lifecycle_reclaimer.reclaim_expired_restores = async () => ({
                had_work: false,
                had_errors: false,
            });
            lifecycle_reclaimer.reclaim_transition_source_data = async () => ({
                had_work: true,
                had_errors: false,
            });
            try {
                assert.strictEqual(
                    await lifecycle_reclaimer.run_batch(),
                    config.LIFECYCLE_RECLAIMER_BATCH_DELAY,
                );
            } finally {
                lifecycle_reclaimer.reclaim_expired_restores = original_expired_restores;
                lifecycle_reclaimer.reclaim_transition_source_data = original_transition_source;
            }
        });

        mocha.it('_next_delay prefers errors over work over empty', function() {
            const orig = {
                error: config.LIFECYCLE_RECLAIMER_ERROR_DELAY,
                batch: config.LIFECYCLE_RECLAIMER_BATCH_DELAY,
                empty: config.LIFECYCLE_RECLAIMER_EMPTY_DELAY,
            };
            config.LIFECYCLE_RECLAIMER_ERROR_DELAY = 111;
            config.LIFECYCLE_RECLAIMER_BATCH_DELAY = 222;
            config.LIFECYCLE_RECLAIMER_EMPTY_DELAY = 333;
            try {
                assert.strictEqual(
                    lifecycle_reclaimer._next_delay([
                        { had_work: true, had_errors: false },
                        { had_work: true, had_errors: true },
                    ]),
                    111,
                );
                assert.strictEqual(
                    lifecycle_reclaimer._next_delay([
                        { had_work: false, had_errors: false },
                        { had_work: true, had_errors: false },
                    ]),
                    222,
                );
                assert.strictEqual(
                    lifecycle_reclaimer._next_delay([
                        { had_work: false, had_errors: false },
                        { had_work: false, had_errors: false },
                    ]),
                    333,
                );
            } finally {
                config.LIFECYCLE_RECLAIMER_ERROR_DELAY = orig.error;
                config.LIFECYCLE_RECLAIMER_BATCH_DELAY = orig.batch;
                config.LIFECYCLE_RECLAIMER_EMPTY_DELAY = orig.empty;
            }
        });
    });

    mocha.describe('update_object_md restore fence', function() {
        mocha.it('rejects restore_status update while expired restore is pending purge', async function() {
            const obj = await upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date(Date.now() - 60_000),
                },
            });

            await assert.rejects(
                () => rpc_client.object.update_object_md({
                    bucket: BUCKET,
                    key: obj.key,
                    obj_id: String(obj._id),
                    restore_status: { ongoing: true, days: 7 },
                }),
                err => err.rpc_code === 'INTERNAL_ERROR',
            );
        });

        mocha.it('rejects restore_status update while transition source is pending purge', async function() {
            const obj = await upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                transition_info: {
                    status: CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                    transition_end_ts: new Date(Date.now() - 60_000),
                    source_info: {
                        storage_class: 'STANDARD',
                    },
                },
            });

            await assert.rejects(
                () => rpc_client.object.update_object_md({
                    bucket: BUCKET,
                    key: obj.key,
                    obj_id: String(obj._id),
                    restore_status: { ongoing: true, days: 7 },
                }),
                err => err.rpc_code === 'INTERNAL_ERROR',
            );
        });

        mocha.it('allows restore_status update after transition source is reclaimed', async function() {
            const obj = await upload_and_patch(BUCKET, {
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                transition_info: {
                    status: CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                    transition_end_ts: new Date(Date.now() - 60_000),
                    source_info: {
                        storage_class: 'STANDARD',
                    },
                },
            });

            const res = await lifecycle_reclaimer.reclaim_transition_source_data();
            assert.ok(res.had_work && !res.had_errors);

            await rpc_client.object.update_object_md({
                bucket: BUCKET,
                key: obj.key,
                obj_id: String(obj._id),
                restore_status: { ongoing: true, days: 7 },
            });
            const after = await MDStore.instance().find_object_by_id(obj._id);
            assert.strictEqual(after.restore_status.ongoing, true);
            assert.strictEqual(after.restore_status.days, 7);
        });
    });
});

///////////////////
// TEST HELPERS  //
///////////////////

/**
 * Multipart upload (STANDARD parts + multiparts), plus an extra MD-only
 * "archive" multipart that is not referenced by any part.
 * @param {object} md_updates
 */
async function multipart_upload_and_patch(bucket, md_updates) {
    const key = `expire-mpu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const num_parts = 2;
    const part_size = 64;
    const size = num_parts * part_size;
    const data = Buffer.alloc(size, 0x62);
    const content_type = 'application/octet-stream';

    const { obj_id } = await rpc_client.object.create_object_upload({
        bucket,
        key,
        content_type,
    });
    const multiparts_reply = [];
    for (let i = 0; i < num_parts; i++) {
        const mp = await object_io.upload_multipart({
            client: rpc_client,
            obj_id,
            bucket,
            key,
            num: i + 1,
            size: part_size,
            source_stream: buffer_utils.buffer_to_read_stream(data.slice(i * part_size, (i + 1) * part_size)),
        });
        multiparts_reply.push(mp);
    }
    const multiparts = multiparts_reply.map((mp, i) => ({ num: i + 1, etag: mp.etag }));
    await rpc_client.object.complete_object_upload({ obj_id, bucket, key, multiparts });

    const oid = MDStore.instance().make_md_id(obj_id);
    let obj = await MDStore.instance().find_object_by_id(oid);
    const parts = await MDStore.instance().find_all_parts_of_object(obj);
    assert.ok(parts.length > 0, 'MPU object should have local parts');
    const standard_mp_ids = [...new Set(
        parts.filter(p => p.multipart).map(p => String(p.multipart))
    )];
    assert.ok(standard_mp_ids.length > 0, 'MPU parts should reference STANDARD multiparts');

    // MD-only deep-archive multipart (no local parts) — must survive reclaim.
    const archive_mp_id = MDStore.instance().make_md_id();
    await MDStore.instance().insert_multipart({
        _id: archive_mp_id,
        system: obj.system,
        bucket: obj.bucket,
        obj: oid,
        num: 1000,
        size: 0,
        etag: 'deep-archive-opaque-etag',
        create_time: new Date(),
    });

    await MDStore.instance().update_object_by_id(oid, md_updates);
    obj = await MDStore.instance().find_object_by_id(oid);
    return { obj, standard_mp_ids, archive_mp_id };
}
