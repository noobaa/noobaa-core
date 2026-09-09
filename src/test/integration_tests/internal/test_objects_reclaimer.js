/* Copyright (C) 2016 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
const { setup, rpc_client, POOL_LIST, EMAIL } = coretest;
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
const test_utils = require('../../system_tests/test_utils');

const object_io = new ObjectIO();
object_io.set_verification_mode();

const BUCKET = 'test-objects-reclaimer-expire';
const ARCHIVE_TARGET_BUCKET = 'test-objects-reclaimer-expire-archive-target';
const ARCHIVE_CONNECTION = 'objects_reclaimer_expire_archive_connection';
const ARCHIVE_NSR = 'objects_reclaimer_expire_archive_nsr';
const OBJ_SIZE = 128;

mocha.describe('ObjectsReclaimer expire paths', function() {
    this.timeout(120000); // eslint-disable-line no-invalid-this

    /** @type {InstanceType<typeof ObjectsReclaimer>} */
    let reclaimer;

    mocha.before(async function() {
        this.timeout(300000); // eslint-disable-line no-invalid-this
        // DEEP_ARCHIVE reclaim treats objects as remote only when the bucket has
        // archive_policy.deep_archive_resource (see is_remote_archive_object).
        config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = false;
        const account_info = await rpc_client.account.read_account({ email: EMAIL });
        await rpc_client.bucket.create_bucket({ name: ARCHIVE_TARGET_BUCKET });
        await rpc_client.account.add_external_connection({
            name: ARCHIVE_CONNECTION,
            endpoint: coretest.get_http_address(),
            endpoint_type: 'S3_COMPATIBLE',
            auth_method: 'AWS_V4',
            identity: account_info.access_keys[0].access_key.unwrap(),
            secret: account_info.access_keys[0].secret_key.unwrap(),
        });
        await rpc_client.pool.create_namespace_resource({
            name: ARCHIVE_NSR,
            connection: ARCHIVE_CONNECTION,
            target_bucket: ARCHIVE_TARGET_BUCKET,
            archive: true,
        });
        await rpc_client.bucket.create_bucket({
            name: BUCKET,
            archive_policy: {
                deep_archive_resource: { resource: ARCHIVE_NSR },
            },
        });
        reclaimer = new ObjectsReclaimer({ name: 'test_object_reclaimer', client: rpc_client });
        // Shared CI DBs can leave a large unreclaimed backlog that fills
        // OBJECT_RECLAIMER_BATCH_SIZE and makes single-batch assertions flaky.
        await drain_unreclaimed_queue(reclaimer);
    });

    mocha.after(async function() {
        try {
            await test_utils.empty_and_delete_buckets(rpc_client, [BUCKET]);
            await rpc_client.pool.delete_namespace_resource({ name: ARCHIVE_NSR });
            await rpc_client.account.delete_external_connection({ connection_name: ARCHIVE_CONNECTION });
            await test_utils.empty_and_delete_buckets(rpc_client, [ARCHIVE_TARGET_BUCKET]);
        } catch (_err) {
            // ignore cleanup failures
        } finally {
            config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = true;
        }
    });

    mocha.describe('reclaim_expired_restores', function() {
        mocha.it('leaves non-expired restore_status untouched', async function() {
            const obj = await upload_and_patch({
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date(Date.now() + 24 * 3600_000),
                },
            });

            const res = await reclaimer.reclaim_expired_restores();
            assert.ok(!res.had_work, 'non-expired restore should not produce reclaim work');
            assert.ok(!res.had_errors, 'reclaim should not error');

            const after = await assert_object_not_deleted(obj._id);
            assert.ok(after.restore_status, 'non-expired restore_status must remain');
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.ok(parts.length > 0, 'non-expired restore mappings must remain');
        });

        mocha.it('deletes local restore mappings and unsets restore_status without deleting the object', async function() {
            const obj = await upload_and_patch({
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date(Date.now() - 60_000),
                },
            });

            const res = await reclaimer.reclaim_expired_restores();
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
            const { obj, standard_mp_ids, archive_mp_id } = await multipart_upload_and_patch({
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date(Date.now() - 60_000),
                },
            });

            const res = await reclaimer.reclaim_expired_restores();
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
    });

    mocha.describe('reclaim_transition_source_data', function() {
        mocha.it('deletes source mappings and sets reclaimed without deleting the object', async function() {
            const obj = await upload_and_patch({
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                    transition_info: {
                        status: CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                        source_info: {
                            storage_class: 'STANDARD',
                            transition_timestamp: new Date(Date.now() - 60_000),
                        },
                    },
            });

            const res = await reclaimer.reclaim_transition_source_data();
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
            const { obj, standard_mp_ids, archive_mp_id } = await multipart_upload_and_patch({
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                    transition_info: {
                        status: CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                        source_info: {
                            storage_class: 'STANDARD',
                            transition_timestamp: new Date(Date.now() - 60_000),
                        },
                    },
            });

            const res = await reclaimer.reclaim_transition_source_data();
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
            const obj = await upload_and_patch({
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date(Date.now() + 60 * 60_000),
                },
                transition_info: {
                    status: CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                    source_info: {
                        storage_class: 'STANDARD',
                        transition_timestamp: new Date(Date.now() - 60_000),
                    },
                },
            });
            const parts_before = await MDStore.instance().find_all_parts_of_object(obj);

            await reclaimer.reclaim_transition_source_data();

            const after = await assert_object_not_deleted(obj._id);
            assert.ok(after.restore_status, 'restore_status should remain');
            assert.ok(!after.transition_info.source_info.reclaimed,
                'transition reclaim must not run while restore_status is set');
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.strictEqual(parts.length, parts_before.length,
                'restore/local parts must not be wiped');
        });
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

        mocha.it('_next_delay prefers errors over work over empty', function() {
            // Use distinct stub delays so preference is proven even if config values coincide.
            const orig = {
                error: config.OBJECT_RECLAIMER_ERROR_DELAY,
                batch: config.OBJECT_RECLAIMER_BATCH_DELAY,
                empty: config.OBJECT_RECLAIMER_EMPTY_DELAY,
            };
            config.OBJECT_RECLAIMER_ERROR_DELAY = 111;
            config.OBJECT_RECLAIMER_BATCH_DELAY = 222;
            config.OBJECT_RECLAIMER_EMPTY_DELAY = 333;
            try {
                assert.strictEqual(
                    reclaimer._next_delay([
                        { had_work: true, had_errors: false },
                        { had_work: true, had_errors: true },
                    ]),
                    111,
                );
                assert.strictEqual(
                    reclaimer._next_delay([
                        { had_work: false, had_errors: false },
                        { had_work: true, had_errors: false },
                    ]),
                    222,
                );
                assert.strictEqual(
                    reclaimer._next_delay([
                        { had_work: false, had_errors: false },
                        { had_work: false, had_errors: false },
                    ]),
                    333,
                );
            } finally {
                config.OBJECT_RECLAIMER_ERROR_DELAY = orig.error;
                config.OBJECT_RECLAIMER_BATCH_DELAY = orig.batch;
                config.OBJECT_RECLAIMER_EMPTY_DELAY = orig.empty;
            }
        });
    });

    mocha.describe('reclaim_deleted_objects', function() {
        mocha.it('reclaims object deleted while restore was still ongoing', async function() {
            // Not picked by reclaim_expired_restores (requires live + ongoing:false).
            // Deleted+any restore_status is cleaned by reclaim_deleted_objects:
            // delete local restore mappings, then archive delete (idempotent if no
            // archive key), then mark reclaimed.
            const obj = await upload_and_patch({
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
    });

    mocha.describe('delete_object_mappings_for_expired_restore_or_transition', function() {
        mocha.it('deletes uploaded object parts but keeps the object MD', async function() {
            const obj = await upload_and_patch({
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
            });
            await map_deleter.delete_object_mappings_for_expired_restore_or_transition(obj);
            const after = await assert_object_not_deleted(obj._id);
            const parts = await MDStore.instance().find_all_parts_of_object(after);
            assert.strictEqual(parts.length, 0);
        });

        mocha.it('is a no-op for objects with no parts', async function() {
            const obj = await upload_and_patch({
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

    mocha.describe('update_restore_info restore fence', function() {
        mocha.it('rejects restore_status update while expired restore is pending purge', async function() {
            const obj = await upload_and_patch({
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date(Date.now() - 60_000),
                },
            });

            await assert.rejects(
                () => rpc_client.object.update_restore_info({
                    obj_id: String(obj._id),
                    restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.START,
                    update_restore_status: { ongoing: true, days: 7 },
                }),
                err => err.rpc_code === 'RESTORE_PENDING_RECLAIM',
            );
        });

        mocha.it('rejects restore_status update while transition source is pending purge', async function() {
            const obj = await upload_and_patch({
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                    transition_info: {
                        status: CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                        source_info: {
                            storage_class: 'STANDARD',
                            transition_timestamp: new Date(Date.now() - 60_000),
                        },
                    },
            });

            await assert.rejects(
                () => rpc_client.object.update_restore_info({
                    obj_id: String(obj._id),
                    restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.START,
                    update_restore_status: { ongoing: true, days: 7 },
                }),
                err => err.rpc_code === 'RESTORE_PENDING_RECLAIM',
            );
        });

        mocha.it('allows restore_status update after transition source is reclaimed', async function() {
            const obj = await upload_and_patch({
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
                    transition_info: {
                        status: CONSTANTS.ARCHIVE.TRANSITION_STATUS.DONE,
                        source_info: {
                            storage_class: 'STANDARD',
                            transition_timestamp: new Date(Date.now() - 60_000),
                        },
                    },
            });

            const res = await reclaimer.reclaim_transition_source_data();
            assert.ok(res.had_work && !res.had_errors);

            await rpc_client.object.update_restore_info({
                obj_id: String(obj._id),
                restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.START,
                update_restore_status: { ongoing: true, days: 7 },
            });
            const after = await MDStore.instance().find_object_by_id(obj._id);
            assert.strictEqual(after.restore_status.ongoing, true);
            assert.strictEqual(after.restore_status.days, 7);
            assert.ok(after.restore_status.restore_claim_id);
        });
    });

    mocha.describe('update_restore_info restore_claim_id', function() {
        mocha.it('rejects stale COMPLETE after clear and re-claim', async function() {
            const obj = await upload_and_patch({
                storage_class: CONSTANTS.ARCHIVE.STORAGE_CLASS.DEEP_ARCHIVE,
            });

            const start_a = await rpc_client.object.update_restore_info({
                obj_id: String(obj._id),
                restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.START,
                update_restore_status: { ongoing: true, days: 7 },
            });
            assert.ok(start_a.cas_matched);
            assert.ok(start_a.restore_claim_id);

            const clear_a = await rpc_client.object.update_restore_info({
                obj_id: String(obj._id),
                expected_restore_claim_id: start_a.restore_claim_id,
                restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.CLEAR_CLAIM,
                update_restore_status: { ongoing: false },
            });
            assert.strictEqual(clear_a.cas_matched, true);

            const start_b = await rpc_client.object.update_restore_info({
                obj_id: String(obj._id),
                restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.START,
                update_restore_status: { ongoing: true, days: 1 },
            });
            assert.ok(start_b.cas_matched);
            assert.ok(start_b.restore_claim_id);
            assert.notStrictEqual(String(start_b.restore_claim_id), String(start_a.restore_claim_id));

            const stale_complete = await rpc_client.object.update_restore_info({
                obj_id: String(obj._id),
                expected_restore_claim_id: start_a.restore_claim_id,
                restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.COMPLETE,
                update_restore_status: {
                    ongoing: false,
                    expiry_time: Date.now() + 7 * 24 * 60 * 60 * 1000,
                },
            });
            assert.strictEqual(stale_complete.cas_matched, false);

            const mid = await MDStore.instance().find_object_by_id(obj._id);
            assert.strictEqual(mid.restore_status.ongoing, true);
            assert.strictEqual(String(mid.restore_status.restore_claim_id), String(start_b.restore_claim_id));
            assert.strictEqual(mid.restore_status.days, 1);

            const complete_b = await rpc_client.object.update_restore_info({
                obj_id: String(obj._id),
                expected_restore_claim_id: start_b.restore_claim_id,
                restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.COMPLETE,
                update_restore_status: {
                    ongoing: false,
                    expiry_time: Date.now() + 1 * 24 * 60 * 60 * 1000,
                },
            });
            assert.strictEqual(complete_b.cas_matched, true);
            const after = await MDStore.instance().find_object_by_id(obj._id);
            assert.strictEqual(after.restore_status.ongoing, false);
            assert.strictEqual(String(after.restore_status.restore_claim_id), String(start_b.restore_claim_id));
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

/**
 * Upload a real object (writes local STANDARD parts/chunks), then patch MD for the
 * reclaim scenario under test.
 *
 * Patching storage_class to DEEP_ARCHIVE/GLACIER does not move data to archive — it
 * only updates object MD so the object looks archived while local mappings still
 * exist (as after restore, or as leftover source data after lifecycle transition).
 * Reclaim tests then verify those local mappings are purged.
 * @param {object} md_updates
 */
async function upload_and_patch(md_updates) {
    const key = `expire-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const data = Buffer.alloc(OBJ_SIZE, 0x61);
    const params = {
        client: rpc_client,
        bucket: BUCKET,
        key,
        size: OBJ_SIZE,
        content_type: 'application/octet-stream',
        source_stream: buffer_utils.buffer_to_read_stream(data),
    };
    await object_io.upload_object(params);
    const obj_id = MDStore.instance().make_md_id(params.obj_id);
    await MDStore.instance().update_object_by_id(obj_id, md_updates);
    const obj = await MDStore.instance().find_object_by_id(obj_id);
    const parts = await MDStore.instance().find_all_parts_of_object(obj);
    assert.ok(parts.length > 0, 'uploaded object should have local parts');
    return obj;
}

/**
 * Multipart upload (STANDARD parts + multiparts), plus an extra MD-only
 * "archive" multipart that is not referenced by any part.
 * @param {object} md_updates
 */
async function multipart_upload_and_patch(md_updates) {
    const key = `expire-mpu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const num_parts = 2;
    const part_size = 64;
    const size = num_parts * part_size;
    const data = Buffer.alloc(size, 0x62);
    const content_type = 'application/octet-stream';

    const { obj_id } = await rpc_client.object.create_object_upload({
        bucket: BUCKET,
        key,
        content_type,
    });
    const multiparts_reply = [];
    for (let i = 0; i < num_parts; i++) {
        const mp = await object_io.upload_multipart({
            client: rpc_client,
            obj_id,
            bucket: BUCKET,
            key,
            num: i + 1,
            size: part_size,
            source_stream: buffer_utils.buffer_to_read_stream(data.slice(i * part_size, (i + 1) * part_size)),
        });
        multiparts_reply.push(mp);
    }
    const multiparts = multiparts_reply.map((mp, i) => ({ num: i + 1, etag: mp.etag }));
    await rpc_client.object.complete_object_upload({ obj_id, bucket: BUCKET, key, multiparts });

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

/**
 * Object MD must remain live — reclaim only drops local copy mappings.
 * @param {object} obj_id
 */
async function assert_object_not_deleted(obj_id) {
    const obj = await MDStore.instance().find_object_by_id(obj_id);
    assert.ok(obj, 'object MD must still exist');
    assert.ok(!obj.deleted, 'object must not be soft-deleted; only local copies are reclaimed');
    return obj;
}
