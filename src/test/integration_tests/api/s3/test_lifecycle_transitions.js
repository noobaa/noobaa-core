/* Copyright (C) 2026 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

/**
 * test_lifecycle_transitions.js
 *
 * Integration tests for S3 lifecycle Transition and NoncurrentVersionTransition.
 */

const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const mocha = require('mocha');
const assert = require('assert');
const mongodb = require('mongodb');

const P = require('../../../../util/promise');
const config = require('../../../../../config');
const MDStore = require('../../../../server/object_services/md_store').MDStore;
const coretest = require('../../../utils/coretest/coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });
const http_utils = require('../../../../util/http_utils');
const COMMON_CONSTANTS = require('../../../../common/constants');
const system_store = require('../../../../server/system_services/system_store').get_instance();

const ARCHIVE = COMMON_CONSTANTS.ARCHIVE;
const { rpc_client, EMAIL } = coretest;
const TRANSITION_BUCKET = 'test-lifecycle-transition-bucket';
const TARGET_STORAGE_CLASS = 'DEEP_ARCHIVE';

function get_bucket_from_store(bucket_name) {
    const system = system_store.data.systems[0];
    const bucket_obj = system.buckets_by_name && system.buckets_by_name[bucket_name];
    assert(bucket_obj, `Bucket ${bucket_name} not found in system_store`);
    return bucket_obj;
}

/**
 * Create an object via RPC and age it by updating create_time in the DB.
 *
 * Note: MDStore rounds create_time to midnight UTC and adds 1 day before comparing
 * against transition_ts. For an object to be eligible with Days=N, its create_time
 * must be at least (N+1) full calendar days in the past (UTC midnight boundary).
 * Use age_days >= RULE_DAYS + 2 to safely clear the midnight boundary.
 */
async function create_aged_object(key, bucket, age_days, opts = {}) {
    const content_type = 'application/octet-stream';
    const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key, content_type });
    await rpc_client.object.complete_object_upload({ obj_id, bucket, key });

    const create_time = new Date();
    create_time.setDate(create_time.getDate() - age_days);
    const update = { create_time };
    if (opts.size !== undefined) update.size = opts.size;

    const id = new mongodb.ObjectId(obj_id);
    await MDStore.instance().update_object_by_id(id, update);
    return obj_id;
}

async function set_transition_rule(s3, bucket, { days, storage_class = TARGET_STORAGE_CLASS, prefix = '' } = {}) {
    await s3.putBucketLifecycleConfiguration({
        Bucket: bucket,
        LifecycleConfiguration: {
            Rules: [{
                ID: 'test-transition',
                Status: 'Enabled',
                Filter: { Prefix: prefix },
                Transitions: [{ Days: days, StorageClass: storage_class }],
            }],
        },
    });
}

async function delete_lifecycle(s3, bucket) {
    try {
        await s3.deleteBucketLifecycle({ Bucket: bucket });
    } catch (err) {
        // ignore if no lifecycle configured
    }
}

mocha.describe('lifecycle-transitions', function() {
    // Not supported in other DBs
    if (config.DB_TYPE !== 'postgres') return;

    let s3;

    mocha.before(async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        config.LIFECYCLE_SCHEDULE_MIN = 0;
        config.LIFECYCLE_INTERVAL = 0;

        const account_info = await rpc_client.account.read_account({ email: EMAIL });
        s3 = new S3({
            endpoint: coretest.get_http_address(),
            credentials: {
                accessKeyId: account_info.access_keys[0].access_key.unwrap(),
                secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
            },
            forcePathStyle: true,
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpAgent: http_utils.get_unsecured_agent(coretest.get_http_address()),
            }),
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // Basic Transition (unversioned bucket)
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Basic Transition (unversioned)', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-a';
        const AGE_DAYS = 5;
        const RULE_DAYS = 1;

        mocha.before(async function() {
            await rpc_client.bucket.create_bucket({ name: bucket });
        });

        mocha.after(async function() {
            await delete_lifecycle(s3, bucket);
            // clean up objects
            const list = await rpc_client.object.list_objects_admin({ bucket });
            for (const obj of list.objects) {
                await rpc_client.object.delete_object({ bucket, key: obj.key });
            }
            await rpc_client.bucket.delete_bucket({ name: bucket });
        });

        mocha.it('should find objects eligible for transition which have age greater than rule',
            async function() {
                const key = 'transition-a-' + Date.now();
                const obj_id = await create_aged_object(key, bucket, AGE_DAYS);
                await set_transition_rule(s3, bucket, { days: RULE_DAYS });

                // Query MDStore directly to verify the object would be found
                const bucket_obj = get_bucket_from_store(bucket);
                const results = await MDStore.instance().find_objects_to_transition({
                    bucket: bucket_obj,
                    batch_size: 100,
                    transition_ts: Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60),
                });
                assert(results.length > 0, `Expected to find eligible objects, got ${results.length}`);

                const found = results.find(o => o._id.toHexString() === obj_id);
                assert(found, `Expected to find object ${obj_id} in eligible results`);
            });

        mocha.it('should NOT find objects which are less than days in the rule', async function() {
            const key = 'transition-a-young-' + Date.now();
            await create_aged_object(key, bucket, 0);

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts: Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60),
            });

            const found = results.find(o => o.key === key);
            assert(!found, `Young object ${key} should NOT be in eligible results`);
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // Transition on versioned bucket (latest versions only)
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Versioned Transition (latest only)', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-b';
        const AGE_DAYS = 5;
        const RULE_DAYS = 1;

        mocha.before(async function() {
            await rpc_client.bucket.create_bucket({ name: bucket });
            await s3.putBucketVersioning({
                Bucket: bucket,
                VersioningConfiguration: { Status: 'Enabled' },
            });
        });

        mocha.after(async function() {
            await delete_lifecycle(s3, bucket);
            const list = await s3.listObjectVersions({ Bucket: bucket });
            const to_delete = [
                ...(list.Versions || []).map(v => ({ Key: v.Key, VersionId: v.VersionId })),
                ...(list.DeleteMarkers || []).map(d => ({ Key: d.Key, VersionId: d.VersionId })),
            ];
            if (to_delete.length) {
                await s3.deleteObjects({ Bucket: bucket, Delete: { Objects: to_delete } });
            }
            await rpc_client.bucket.delete_bucket({ name: bucket });
        });

        mocha.it('should find only the latest version eligible', async function() {
            const key = 'transition-b-' + Date.now();

            // Create 3 versions, age all of them
            for (let i = 0; i < 3; i++) {
                await create_aged_object(key, bucket, AGE_DAYS);
            }

            const bucket_obj = get_bucket_from_store(bucket);
            const transition_ts = Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60);

            // For is_latest=true, object_server reuses find_objects_to_transition
            // which filters version_past IS NULL → only current version
            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts,
            });

            const matching = results.filter(o => o.key === key);
            assert.strictEqual(matching.length, 1,
                `Expected exactly 1 latest version, got ${matching.length}`);
            assert(!matching[0].version_past,
                'Expected found object to be the latest (version_past should be falsy)');
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // NoncurrentVersionTransition
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('NoncurrentVersionTransition', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-c';
        const AGE_DAYS = 10;
        const NONCURRENT_DAYS = 1;
        const NEWER_NONCURRENT_VERSIONS = 1;
        const NUM_VERSIONS = 5;

        mocha.before(async function() {
            await rpc_client.bucket.create_bucket({ name: bucket });
            await s3.putBucketVersioning({
                Bucket: bucket,
                VersioningConfiguration: { Status: 'Enabled' },
            });
        });

        mocha.after(async function() {
            await delete_lifecycle(s3, bucket);
            const list = await s3.listObjectVersions({ Bucket: bucket });
            const to_delete = [
                ...(list.Versions || []).map(v => ({ Key: v.Key, VersionId: v.VersionId })),
                ...(list.DeleteMarkers || []).map(d => ({ Key: d.Key, VersionId: d.VersionId })),
            ];
            if (to_delete.length) {
                await s3.deleteObjects({ Bucket: bucket, Delete: { Objects: to_delete } });
            }
            await rpc_client.bucket.delete_bucket({ name: bucket });
        });

        mocha.it('should respect NewerNoncurrentVersions retention count', async function() {
            const key = 'transition-c-' + Date.now();

            for (let i = 0; i < NUM_VERSIONS; i++) {
                await create_aged_object(key, bucket, AGE_DAYS);
                await P.delay(100);
            }

            const bucket_obj = get_bucket_from_store(bucket);

            const results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: NONCURRENT_DAYS,
                newer_noncurrent_versions: NEWER_NONCURRENT_VERSIONS,
            });

            const matching = results.filter(o => o.key === key);

            // 5 versions total: 1 current + 4 noncurrent.
            // NewerNoncurrentVersions=1 retains the 1 newest noncurrent version.
            // So 3 older noncurrent versions should be eligible.
            const expected_eligible = NUM_VERSIONS - 1 - NEWER_NONCURRENT_VERSIONS;
            assert.strictEqual(matching.length, expected_eligible,
                `Expected ${expected_eligible} eligible noncurrent versions, got ${matching.length}. ` +
                `(${NUM_VERSIONS} total - 1 current - ${NEWER_NONCURRENT_VERSIONS} retained)`);

            // All returned objects should be noncurrent (version_past=true)
            for (const obj of matching) {
                assert.strictEqual(obj.version_past, true,
                    `Expected version_past=true for noncurrent version, got ${obj.version_past}`);
            }
        });

        mocha.it('should return all noncurrent when NewerNoncurrentVersions is 0', async function() {
            const key = 'transition-c-all-' + Date.now();

            for (let i = 0; i < 3; i++) {
                await create_aged_object(key, bucket, AGE_DAYS);
                await P.delay(100);
            }

            const bucket_obj = get_bucket_from_store(bucket);

            const results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: NONCURRENT_DAYS,
            });

            const matching = results.filter(o => o.key === key);
            // 3 versions: 1 current + 2 noncurrent. Both noncurrent should be eligible.
            assert.strictEqual(matching.length, 2,
                `Expected 2 eligible noncurrent versions (no retention), got ${matching.length}`);
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // Pagination
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Pagination', function() {
        this.timeout(120000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-d';
        const SMALL_BATCH = 3;
        const NUM_OBJECTS = SMALL_BATCH * 3 + 1; // 10 objects → 4 batches
        const AGE_DAYS = 5;
        const RULE_DAYS = 1;

        mocha.before(async function() {
            await rpc_client.bucket.create_bucket({ name: bucket });
        });

        mocha.after(async function() {
            await delete_lifecycle(s3, bucket);
            const list = await rpc_client.object.list_objects_admin({ bucket });
            for (const obj of list.objects) {
                await rpc_client.object.delete_object({ bucket, key: obj.key });
            }
            await rpc_client.bucket.delete_bucket({ name: bucket });
        });

        mocha.it('should paginate through all eligible objects', async function() {
            const prefix = 'pagination-d-' + Date.now();
            for (let i = 0; i < NUM_OBJECTS; i++) {
                const key = `${prefix}-${String(i).padStart(4, '0')}`;
                await create_aged_object(key, bucket, AGE_DAYS);
            }

            const bucket_obj = get_bucket_from_store(bucket);
            const transition_ts = Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60);

            // Manually paginate through results
            let all_results = [];
            let key_marker;
            let page = 0;
            let is_truncated = true;

            while (is_truncated) {
                const batch = await MDStore.instance().find_objects_to_transition({
                    bucket: bucket_obj,
                    batch_size: SMALL_BATCH,
                    key_marker,
                    transition_ts,
                });

                const matching = batch.filter(o => o.key.startsWith(prefix));
                all_results = all_results.concat(matching);
                page += 1;

                is_truncated = batch.length >= SMALL_BATCH;
                key_marker = batch.length ? batch[batch.length - 1].key : undefined;
            }

            assert.strictEqual(all_results.length, NUM_OBJECTS,
                `Expected ${NUM_OBJECTS} objects across ${page} pages, got ${all_results.length}`);

            // Verify sorted order (key ASC)
            for (let i = 1; i < all_results.length; i++) {
                assert(all_results[i].key > all_results[i - 1].key,
                    `Results should be sorted by key ASC: ` +
                    `${all_results[i - 1].key} should be before ${all_results[i].key}`);
            }
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // Concurrency guards
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Concurrency guards', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-e';
        const AGE_DAYS = 5;
        const RULE_DAYS = 1;

        mocha.before(async function() {
            await rpc_client.bucket.create_bucket({ name: bucket });
        });

        mocha.after(async function() {
            await delete_lifecycle(s3, bucket);
            const list = await rpc_client.object.list_objects_admin({ bucket });
            for (const obj of list.objects) {
                await rpc_client.object.delete_object({ bucket, key: obj.key });
            }
            await rpc_client.bucket.delete_bucket({ name: bucket });
        });

        mocha.it('should skip objects with transition_info=IN_PROGRESS', async function() {
            const key = 'guard-in-progress-' + Date.now();
            const obj_id = await create_aged_object(key, bucket, AGE_DAYS);

            // Directly set transition_info via MDStore
            const id = new mongodb.ObjectId(obj_id);
            await MDStore.instance().update_object_by_id(id, {
                transition_info: { status: ARCHIVE.TRANSITION_STATUS.IN_PROGRESS },
            });

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts: Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60),
            });

            const found = results.find(o => o._id.toHexString() === obj_id);
            assert(!found,
                'Object with transition_info=IN_PROGRESS should NOT appear in results');
        });

        mocha.it('should skip objects with transition_info=DONE', async function() {
            const key = 'guard-done-' + Date.now();
            const obj_id = await create_aged_object(key, bucket, AGE_DAYS);

            const id = new mongodb.ObjectId(obj_id);
            await MDStore.instance().update_object_by_id(id, {
                transition_info: {
                    status: ARCHIVE.TRANSITION_STATUS.DONE,
                    source_info: {
                        storage_class: 'STANDARD',
                        transition_timestamp: new Date(),
                    },
                },
                storage_class: TARGET_STORAGE_CLASS,
            });

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts: Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60),
            });

            const found = results.find(o => o._id.toHexString() === obj_id);
            assert(!found,
                'Object with transition_info=DONE should NOT appear in results');
        });

        mocha.it('should skip deleted objects', async function() {
            const key = 'guard-deleted-' + Date.now();
            const obj_id = await create_aged_object(key, bucket, AGE_DAYS);

            await rpc_client.object.delete_object({ bucket, key });

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts: Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60),
            });

            const found = results.find(o => o._id.toHexString() === obj_id);
            assert(!found,
                'Deleted object should NOT appear in transition results');
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // Midnight UTC rounding boundary
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Midnight UTC rounding', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-g';

        mocha.before(async function() {
            await rpc_client.bucket.create_bucket({ name: bucket });
            await s3.putBucketVersioning({
                Bucket: bucket,
                VersioningConfiguration: { Status: 'Enabled' },
            });
        });

        mocha.after(async function() {
            await delete_lifecycle(s3, bucket);
            const list = await s3.listObjectVersions({ Bucket: bucket });
            const to_delete = [
                ...(list.Versions || []).map(v => ({ Key: v.Key, VersionId: v.VersionId })),
                ...(list.DeleteMarkers || []).map(d => ({ Key: d.Key, VersionId: d.VersionId })),
            ];
            if (to_delete.length) {
                await s3.deleteObjects({ Bucket: bucket, Delete: { Objects: to_delete } });
            }
            await rpc_client.bucket.delete_bucket({ name: bucket });
        });

        mocha.it('Transition Days=0: object created today is NOT eligible (midnight rounding)', async function() {
            // Object created "now" → date_trunc('day', create_time) + 1 day = tomorrow midnight
            // transition_ts = now → tomorrow midnight > now → NOT eligible
            const key = 'midnight-today-' + Date.now();
            await create_aged_object(key, bucket, 0);

            const bucket_obj = get_bucket_from_store(bucket);
            const transition_ts = Math.floor(Date.now() / 1000);

            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts,
            });

            const found = results.find(o => o.key === key);
            assert(!found,
                'Object created today should NOT be eligible with Days=0 due to midnight rounding');
        });

        mocha.it('Transition Days=0: object created 2 days ago IS eligible', async function() {
            // Object aged 2 days → date_trunc('day', 2_days_ago) + 1 day = yesterday midnight
            // transition_ts = now → yesterday midnight <= now → ELIGIBLE
            const key = 'midnight-old-' + Date.now();
            await create_aged_object(key, bucket, 2);

            const bucket_obj = get_bucket_from_store(bucket);
            const transition_ts = Math.floor(Date.now() / 1000);

            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts,
            });

            const found = results.find(o => o.key === key);
            assert(found,
                'Object created 2 days ago should be eligible with Days=0');
        });

        mocha.it('NoncurrentVersionTransition NoncurrentDays=0: version made noncurrent today is NOT eligible', async function() {
            // Create 2 versions (both with today's create_time).
            // successor_time for v1 = create_time of v2 = today
            // date_trunc('day', today) + 1 day = tomorrow → NOT eligible
            const key = 'midnight-noncurrent-today-' + Date.now();
            await create_aged_object(key, bucket, 0);
            await P.delay(100);
            await create_aged_object(key, bucket, 0);

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: 0,
            });

            const found = results.find(o => o.key === key);
            assert(!found,
                'Noncurrent version from today should NOT be eligible with NoncurrentDays=0');
        });

        mocha.it('NoncurrentVersionTransition NoncurrentDays=0: version made noncurrent 2 days ago IS eligible', async function() {
            // Create 2 versions, both aged 2 days.
            // successor_time = create_time of v2 = 2 days ago
            // date_trunc('day', 2_days_ago) + 1 day = yesterday → eligible (now >= yesterday)
            const key = 'midnight-noncurrent-old-' + Date.now();
            await create_aged_object(key, bucket, 2);
            await P.delay(100);
            await create_aged_object(key, bucket, 2);

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: 0,
            });

            const matching = results.filter(o => o.key === key);
            assert(matching.length >= 1,
                'Noncurrent version from 2 days ago should be eligible with NoncurrentDays=0');
        });
    });
});
