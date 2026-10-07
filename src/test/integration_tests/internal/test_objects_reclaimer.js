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
const { ObjectsReclaimer } = require('../../../server/bg_services/objects_reclaimer');
const { MDStore } = require('../../../server/object_services/md_store');
const map_deleter = require('../../../server/object_services/map_deleter');
const {
    create_archive_bucket,
    delete_archive_bucket,
    upload_and_patch,
    assert_object_not_deleted,
} = require('../../utils/reclaimers_test_utils');

const BUCKET = 'test-objects-reclaimer-expire';
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
        reclaimer = new ObjectsReclaimer({ name: 'test_object_reclaimer', client: rpc_client });
        // Shared CI DBs can leave a large unreclaimed backlog that fills
        // OBJECT_RECLAIMER_BATCH_SIZE and makes single-batch assertions flaky.
        await drain_unreclaimed_queue(reclaimer);
    });

    mocha.after(async function() {
        await delete_archive_bucket(ARCHIVE_NAMES);
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

