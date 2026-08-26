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
const test_utils = require('../../../system_tests/test_utils');
const TRANSITION_BUCKET = 'test-lifecycle-transition-bucket';
const TARGET_STORAGE_CLASS = 'DEEP_ARCHIVE';
const ARCHIVE_CONNECTION = 'lifecycle-transition-archive-connection';
const ARCHIVE_NSR = 'lifecycle-transition-archive-nsr';
const ARCHIVE_TARGET = 'lifecycle-transition-archive-target';

async function create_archive_bucket(name) {
    await rpc_client.bucket.create_bucket({
        name,
        archive_policy: {
            deep_archive_resource: { resource: ARCHIVE_NSR },
        },
    });
}

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

        config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = false;
        await s3.createBucket({ Bucket: ARCHIVE_TARGET });
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
            target_bucket: ARCHIVE_TARGET,
            archive: true,
        });
    });

    mocha.after(async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        try {
            await rpc_client.pool.delete_namespace_resource({ name: ARCHIVE_NSR });
            await rpc_client.account.delete_external_connection({ connection_name: ARCHIVE_CONNECTION });
            await test_utils.empty_and_delete_buckets(rpc_client, [ARCHIVE_TARGET]);
        } finally {
            config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = true;
        }
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
            await create_archive_bucket(bucket);
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
    // Transition filters (prefix, size, tags)
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Transition filters', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-l';
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

        mocha.it('should filter by prefix', async function() {
            const ts = Date.now();
            const key_logs_a = `logs/tfilt-a-${ts}`;
            const key_logs_b = `logs/tfilt-b-${ts}`;
            const key_data_c = `data/tfilt-c-${ts}`;

            for (const key of [key_logs_a, key_logs_b, key_data_c]) {
                await create_aged_object(key, bucket, AGE_DAYS);
            }

            const bucket_obj = get_bucket_from_store(bucket);
            const transition_ts = Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60);

            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts,
                prefix: 'logs/',
            });

            const matching_logs = results.filter(o => o.key.startsWith('logs/tfilt-'));
            const matching_data = results.filter(o => o.key.startsWith('data/tfilt-'));
            assert(matching_logs.length === 2,
                `Expected 2 logs/* objects, got ${matching_logs.length}`);
            assert.strictEqual(matching_data.length, 0,
                'data/* objects should be excluded by prefix filter');
        });

        mocha.it('should filter by size_greater', async function() {
            const ts = Date.now();
            const key_small = `szgt-small-${ts}`;
            const key_large = `szgt-large-${ts}`;

            await create_aged_object(key_small, bucket, AGE_DAYS, { size: 100 });
            await create_aged_object(key_large, bucket, AGE_DAYS, { size: 1000 });

            const bucket_obj = get_bucket_from_store(bucket);
            const transition_ts = Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60);

            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts,
                size_greater: 500,
            });

            const found_small = results.find(o => o.key === key_small);
            const found_large = results.find(o => o.key === key_large);
            assert(!found_small, 'Small object should be excluded by size_greater filter');
            assert(found_large, 'Large object should be included');
        });

        mocha.it('should filter by size_less', async function() {
            const ts = Date.now();
            const key_small = `szlt-small-${ts}`;
            const key_large = `szlt-large-${ts}`;

            await create_aged_object(key_small, bucket, AGE_DAYS, { size: 100 });
            await create_aged_object(key_large, bucket, AGE_DAYS, { size: 1000 });

            const bucket_obj = get_bucket_from_store(bucket);
            const transition_ts = Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60);

            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts,
                size_less: 500,
            });

            const found_small = results.find(o => o.key === key_small);
            const found_large = results.find(o => o.key === key_large);
            assert(found_small, 'Small object should be included');
            assert(!found_large, 'Large object should be excluded by size_less filter');
        });

        mocha.it('should filter by tags', async function() {
            const ts = Date.now();
            const key_tagged = `tag-yes-${ts}`;
            const key_untagged = `tag-no-${ts}`;

            const tagged_id = await create_aged_object(key_tagged, bucket, AGE_DAYS);
            await create_aged_object(key_untagged, bucket, AGE_DAYS);

            // Tag the object via MDStore
            const id = new mongodb.ObjectId(tagged_id);
            await MDStore.instance().update_object_by_id(id, {
                tagging: [{ key: 'env', value: 'prod' }],
            });

            const bucket_obj = get_bucket_from_store(bucket);
            const transition_ts = Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60);

            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts,
                tags: [{ key: 'env', value: 'prod' }],
            });

            const found_tagged = results.find(o => o.key === key_tagged);
            const found_untagged = results.find(o => o.key === key_untagged);
            assert(found_tagged, 'Tagged object should be in results');
            assert(!found_untagged, 'Untagged object should be excluded by tag filter');
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // Transition multi-key ordering
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Transition multi-key ordering', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-m';
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

        mocha.it('should return results sorted by key ASC', async function() {
            const ts = Date.now();
            // Create in reverse order to ensure sort is DB-driven, not insertion-order
            const keys = [`zzz-order-${ts}`, `mmm-order-${ts}`, `aaa-order-${ts}`];
            for (const key of keys) {
                await create_aged_object(key, bucket, AGE_DAYS);
            }

            const bucket_obj = get_bucket_from_store(bucket);
            const transition_ts = Math.floor(Date.now() / 1000) - (RULE_DAYS * 24 * 60 * 60);

            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts,
            });

            const matching = results.filter(o => keys.includes(o.key));
            assert.strictEqual(matching.length, 3,
                `Expected 3 objects, got ${matching.length}`);

            for (let i = 1; i < matching.length; i++) {
                assert(matching[i].key > matching[i - 1].key,
                    `Results should be sorted by key ASC: ` +
                    `${matching[i - 1].key} should come before ${matching[i].key}`);
            }
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // Date-based Transition (is_date flag)
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Date-based Transition', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-n';
        const AGE_DAYS = 5;

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

        mocha.it('should return empty when is_date=true and transition date is in the future', async function() {
            const key = 'date-future-' + Date.now();
            await create_aged_object(key, bucket, AGE_DAYS);

            const bucket_obj = get_bucket_from_store(bucket);
            // Set transition_ts to tomorrow (future)
            const future_ts = Math.floor(Date.now() / 1000) + (24 * 60 * 60);

            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts: future_ts,
                is_date: true,
            });

            assert.strictEqual(results.length, 0,
                'Should return empty array when is_date=true and date is in the future');
        });

        mocha.it('should return eligible objects when is_date=true and transition date is in the past', async function() {
            const key = 'date-past-' + Date.now();
            await create_aged_object(key, bucket, AGE_DAYS);

            const bucket_obj = get_bucket_from_store(bucket);
            // Set transition_ts to yesterday (past)
            const past_ts = Math.floor(Date.now() / 1000) - (24 * 60 * 60);

            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts: past_ts,
                is_date: true,
            });

            const found = results.find(o => o.key === key);
            assert(found,
                'Object should be eligible when is_date=true and date is in the past');
        });

        mocha.it('is_date=true should skip the create_time midnight rounding filter', async function() {
            // With is_date, objects of any age should be returned (no days-based filter)
            const key = 'date-young-' + Date.now();
            await create_aged_object(key, bucket, 0); // created just now

            const bucket_obj = get_bucket_from_store(bucket);
            const past_ts = Math.floor(Date.now() / 1000) - (24 * 60 * 60);

            const results = await MDStore.instance().find_objects_to_transition({
                bucket: bucket_obj,
                batch_size: 100,
                transition_ts: past_ts,
                is_date: true,
            });

            const found = results.find(o => o.key === key);
            assert(found,
                'Young object should be eligible with is_date=true (no create_time filter applied)');
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

    // ──────────────────────────────────────────────────────────────────────
    // Multiple Transitions in one rule
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Multiple Transitions', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-multi';

        mocha.before(async function() {
            await create_archive_bucket(bucket);
        });

        mocha.after(async function() {
            await delete_lifecycle(s3, bucket);
            await rpc_client.bucket.delete_bucket({ name: bucket });
        });

        mocha.it('should store and return every Transition in the rule', async function() {
            await s3.putBucketLifecycleConfiguration({
                Bucket: bucket,
                LifecycleConfiguration: {
                    Rules: [{
                        ID: 'multi-transition',
                        Status: 'Enabled',
                        Filter: { Prefix: '' },
                        Transitions: [
                            { Days: 30, StorageClass: 'GLACIER' },
                            { Days: 90, StorageClass: TARGET_STORAGE_CLASS },
                        ],
                    }],
                },
            });

            const res = await s3.getBucketLifecycleConfiguration({ Bucket: bucket });
            assert.strictEqual(res.Rules[0].Transitions.length, 2);
            assert.strictEqual(res.Rules[0].Transitions[0].StorageClass, 'GLACIER');
            assert.strictEqual(res.Rules[0].Transitions[1].StorageClass, TARGET_STORAGE_CLASS);

            const stored = get_bucket_from_store(bucket).lifecycle_configuration_rules[0].transitions;
            assert(Array.isArray(stored), 'stored transition should be an array');
            assert.strictEqual(stored.length, 2);
            assert.strictEqual(stored[0].storage_class, 'GLACIER');
            assert.strictEqual(stored[1].storage_class, TARGET_STORAGE_CLASS);
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // PUT lifecycle Transition validation
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('PUT lifecycle Transition validation', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const archive_bucket = TRANSITION_BUCKET + '-put-archive';
        const no_archive_bucket = TRANSITION_BUCKET + '-put-no-archive';

        mocha.before(async function() {
            await create_archive_bucket(archive_bucket);
            await rpc_client.bucket.create_bucket({ name: no_archive_bucket });
        });

        mocha.after(async function() {
            await delete_lifecycle(s3, archive_bucket);
            await delete_lifecycle(s3, no_archive_bucket);
            await rpc_client.bucket.delete_bucket({ name: archive_bucket });
            await rpc_client.bucket.delete_bucket({ name: no_archive_bucket });
        });

        async function put_rule(bucket, extra_rule_fields) {
            return s3.putBucketLifecycleConfiguration({
                Bucket: bucket,
                LifecycleConfiguration: {
                    Rules: [{
                        ID: 'validate-transition',
                        Status: 'Enabled',
                        Filter: { Prefix: 'test/' },
                        ...extra_rule_fields,
                    }],
                },
            });
        }

        async function assert_rejected(bucket, extra_rule_fields, code, message) {
            try {
                await put_rule(bucket, extra_rule_fields);
                assert.fail(`expected putBucketLifecycleConfiguration to fail with ${code}`);
            } catch (err) {
                assert.strictEqual(err.Code, code, err.message);
                if (message) assert.strictEqual(err.message, message);
            }
        }

        mocha.it('should reject Transition when the bucket has no archive policy', async function() {
            await assert_rejected(no_archive_bucket, {
                Transitions: [{ Days: 1, StorageClass: 'DEEP_ARCHIVE' }],
            }, 'InvalidRequest',
                "'Transition' and 'NoncurrentVersionTransition' actions require the bucket to have an archive policy attached.");
        });

        mocha.it('should reject NoncurrentVersionTransition when the bucket has no archive policy', async function() {
            await assert_rejected(no_archive_bucket, {
                NoncurrentVersionTransitions: [{ NoncurrentDays: 1, StorageClass: 'GLACIER' }],
            }, 'InvalidRequest',
                "'Transition' and 'NoncurrentVersionTransition' actions require the bucket to have an archive policy attached.");
        });

        mocha.it('should reject StorageClass that is not GLACIER or DEEP_ARCHIVE', async function() {
            await assert_rejected(archive_bucket, {
                Transitions: [{ Days: 1, StorageClass: 'STANDARD_IA' }],
            }, 'MalformedXML');
        });

        mocha.it('should reject Transition that specifies both Days and Date', async function() {
            await assert_rejected(archive_bucket, {
                Transitions: [{
                    Days: 1,
                    Date: new Date('2026-01-01T00:00:00.000Z'),
                    StorageClass: 'DEEP_ARCHIVE',
                }],
            }, 'MalformedXML');
        });

        mocha.it('should reject Transition that specifies neither Days nor Date', async function() {
            await assert_rejected(archive_bucket, {
                Transitions: [{ StorageClass: 'DEEP_ARCHIVE' }],
            }, 'InvalidArgument',
                "'Transition' action must specify either 'Days' or 'Date'");
        });

        mocha.it('should reject Transition that omits StorageClass', async function() {
            await assert_rejected(archive_bucket, {
                Transitions: [{ Days: 1 }],
            }, 'MalformedXML');
        });

        mocha.it('should reject empty Transition action', async function() {
            await assert_rejected(archive_bucket, {
                Transitions: [{}],
            }, 'MalformedXML');
        });

        mocha.it('should reject Transition Date that is not midnight UTC', async function() {
            await assert_rejected(archive_bucket, {
                Transitions: [{
                    Date: new Date('2026-01-01T15:00:00.000Z'),
                    StorageClass: 'DEEP_ARCHIVE',
                }],
            }, 'InvalidArgument',
                "'Date' must be at midnight GMT");
        });

        mocha.it('should reject negative Transition Days', async function() {
            await assert_rejected(archive_bucket, {
                Transitions: [{ Days: -1, StorageClass: 'DEEP_ARCHIVE' }],
            }, 'InvalidArgument',
                "'Days' in Transition action must be nonnegative");
        });

        mocha.it('should reject mixed Days and Date Transitions in the same rule', async function() {
            await assert_rejected(archive_bucket, {
                Transitions: [
                    { Days: 30, StorageClass: 'GLACIER' },
                    { Date: new Date('2026-01-01T00:00:00.000Z'), StorageClass: 'DEEP_ARCHIVE' },
                ],
            }, 'InvalidRequest',
                "Found mixed 'Date' and 'Days' based Transition actions in lifecycle rule for filter '(prefix=test/)'");
        });

        mocha.it('should reject mixed Expiration Date and Transition Days in the same rule', async function() {
            await assert_rejected(archive_bucket, {
                Expiration: { Date: new Date('2027-01-03T00:00:00.000Z') },
                Transitions: [{ Days: 12, StorageClass: 'DEEP_ARCHIVE' }],
            }, 'InvalidRequest',
                "Found mixed 'Date' and 'Days' based Expiration and Transition actions in lifecycle rule for filter '(prefix=test/)'");
        });

        mocha.it('should reject mixed Expiration Days and Transition Date in the same rule', async function() {
            await assert_rejected(archive_bucket, {
                Expiration: { Days: 180 },
                Transitions: [{ Date: new Date('2027-01-01T00:00:00.000Z'), StorageClass: 'DEEP_ARCHIVE' }],
            }, 'InvalidRequest',
                "Found mixed 'Date' and 'Days' based Expiration and Transition actions in lifecycle rule for filter '(prefix=test/)'");
        });

        mocha.it('should reject duplicate StorageClass in Transitions', async function() {
            await assert_rejected(archive_bucket, {
                Transitions: [
                    { Days: 90, StorageClass: 'DEEP_ARCHIVE' },
                    { Days: 180, StorageClass: 'DEEP_ARCHIVE' },
                ],
            }, 'InvalidRequest',
                `'StorageClass' must be different for 'Transition' actions in same 'Rule' with filter '(prefix=test/)'`);
        });

        mocha.it('should reject duplicate StorageClass before Days ordering', async function() {
            await assert_rejected(archive_bucket, {
                Transitions: [
                    { Days: 90, StorageClass: 'GLACIER' },
                    { Days: 30, StorageClass: 'GLACIER' },
                ],
            }, 'InvalidRequest',
                `'StorageClass' must be different for 'Transition' actions in same 'Rule' with filter '(prefix=test/)'`);
        });

        mocha.it('should reject Expiration Days that are not greater than Transition Days', async function() {
            try {
                await put_rule(archive_bucket, {
                    Expiration: { Days: 180 },
                    Transitions: [{ Days: 180, StorageClass: 'DEEP_ARCHIVE' }],
                });
                assert.fail('expected putBucketLifecycleConfiguration to fail with InvalidArgument');
            } catch (err) {
                assert.strictEqual(err.Code, 'InvalidArgument');
                assert.strictEqual(err.message,
                    `'Days' in the Expiration action for filter '(prefix=test/)' must be greater than 'Days' in the Transition action`);
            }
        });

        mocha.it('should reject Expiration Date that is not greater than Transition Date', async function() {
            const same_midnight = new Date('2027-01-01T00:00:00.000Z');
            try {
                await put_rule(archive_bucket, {
                    Expiration: { Date: same_midnight },
                    Transitions: [{ Date: same_midnight, StorageClass: 'DEEP_ARCHIVE' }],
                });
                assert.fail('expected putBucketLifecycleConfiguration to fail with InvalidArgument');
            } catch (err) {
                assert.strictEqual(err.Code, 'InvalidArgument');
                assert.strictEqual(err.message,
                    `'Date' in the Expiration action for filter '(prefix=test/)' must be greater than 'Date' in the Transition action`);
            }
        });

        mocha.it('should reject NoncurrentVersionExpiration NoncurrentDays that are not greater than NoncurrentVersionTransition', async function() {
            try {
                await put_rule(archive_bucket, {
                    NoncurrentVersionExpiration: { NoncurrentDays: 180 },
                    NoncurrentVersionTransitions: [{ NoncurrentDays: 180, StorageClass: 'DEEP_ARCHIVE' }],
                });
                assert.fail('expected putBucketLifecycleConfiguration to fail with InvalidArgument');
            } catch (err) {
                assert.strictEqual(err.Code, 'InvalidArgument');
                assert.strictEqual(err.message,
                    `'NoncurrentDays' in the NoncurrentVersionExpiration action for filter '(prefix=test/)' must be greater than 'NoncurrentDays' in the NoncurrentVersionTransition action`);
            }
        });

        mocha.it('should include And filter fields in the NoncurrentDays ordering error', async function() {
            try {
                await s3.putBucketLifecycleConfiguration({
                    Bucket: archive_bucket,
                    LifecycleConfiguration: {
                        Rules: [{
                            ID: 'validate-transition',
                            Status: 'Enabled',
                            Filter: {
                                And: {
                                    Prefix: 'test/',
                                    ObjectSizeLessThan: 120120,
                                },
                            },
                            NoncurrentVersionExpiration: { NoncurrentDays: 1 },
                            NoncurrentVersionTransitions: [{ NoncurrentDays: 1, StorageClass: 'DEEP_ARCHIVE' }],
                        }],
                    },
                });
                assert.fail('expected putBucketLifecycleConfiguration to fail with InvalidArgument');
            } catch (err) {
                assert.strictEqual(err.Code, 'InvalidArgument');
                assert.strictEqual(err.message,
                    `'NoncurrentDays' in the NoncurrentVersionExpiration action for filter '(prefix=test/ and objectsizelessthan=120120)' must be greater than 'NoncurrentDays' in the NoncurrentVersionTransition action`);
            }
        });

        mocha.it('should include ObjectSizeGreaterThan in the filter error text', async function() {
            await assert_rejected(archive_bucket, {
                Filter: { ObjectSizeGreaterThan: 1048576 },
                NoncurrentVersionExpiration: { NoncurrentDays: 1 },
                NoncurrentVersionTransitions: [{ NoncurrentDays: 1, StorageClass: 'DEEP_ARCHIVE' }],
            }, 'InvalidArgument',
                `'NoncurrentDays' in the NoncurrentVersionExpiration action for filter '(objectsizegreaterthan=1048576)' must be greater than 'NoncurrentDays' in the NoncurrentVersionTransition action`);
        });

        mocha.it('should include Tag in the filter error text', async function() {
            await assert_rejected(archive_bucket, {
                Filter: { Tag: { Key: 'archive', Value: 'true' } },
                NoncurrentVersionExpiration: { NoncurrentDays: 1 },
                NoncurrentVersionTransitions: [{ NoncurrentDays: 1, StorageClass: 'DEEP_ARCHIVE' }],
            }, 'InvalidArgument',
                `'NoncurrentDays' in the NoncurrentVersionExpiration action for filter '(tag={key=archive, value=true})' must be greater than 'NoncurrentDays' in the NoncurrentVersionTransition action`);
        });

        mocha.it('should include Prefix, Tag, and ObjectSize in And filter error text', async function() {
            await assert_rejected(archive_bucket, {
                Filter: {
                    And: {
                        Prefix: 'test/',
                        Tags: [{ Key: 'archive', Value: 'true' }],
                        ObjectSizeGreaterThan: 500,
                        ObjectSizeLessThan: 120120,
                    },
                },
                NoncurrentVersionExpiration: { NoncurrentDays: 1 },
                NoncurrentVersionTransitions: [{ NoncurrentDays: 1, StorageClass: 'DEEP_ARCHIVE' }],
            }, 'InvalidArgument',
                `'NoncurrentDays' in the NoncurrentVersionExpiration action for filter '(prefix=test/ and tag={key=archive, value=true} and objectsizegreaterthan=500 and objectsizelessthan=120120)' must be greater than 'NoncurrentDays' in the NoncurrentVersionTransition action`);
        });

        mocha.it('should reject Prefix combined with ObjectSize at Filter top level without And', async function() {
            await assert_rejected(archive_bucket, {
                Filter: { Prefix: 'test/', ObjectSizeLessThan: 120120 },
                NoncurrentVersionExpiration: { NoncurrentDays: 1 },
            }, 'MalformedXML');
        });

        mocha.it('should reject negative NoncurrentDays', async function() {
            await assert_rejected(archive_bucket, {
                NoncurrentVersionTransitions: [{ NoncurrentDays: -1, StorageClass: 'GLACIER' }],
            }, 'InvalidArgument',
                "'NoncurrentDays' in NoncurrentVersionTransition action must be nonnegative");
        });

        mocha.it('should reject NewerNoncurrentVersions that is not a positive integer', async function() {
            await assert_rejected(archive_bucket, {
                NoncurrentVersionTransitions: [{
                    NoncurrentDays: 1,
                    NewerNoncurrentVersions: 0,
                    StorageClass: 'DEEP_ARCHIVE',
                }],
            }, 'InvalidArgument',
                'NewerNoncurrentVersions must be a positive integer');
        });

        mocha.it('should accept Transition Days=0 with StorageClass=DEEP_ARCHIVE', async function() {
            await put_rule(archive_bucket, {
                Transitions: [{ Days: 0, StorageClass: 'DEEP_ARCHIVE' }],
            });
            const res = await s3.getBucketLifecycleConfiguration({ Bucket: archive_bucket });
            assert.strictEqual(res.Rules[0].Transitions[0].Days, 0);
            assert.strictEqual(res.Rules[0].Transitions[0].StorageClass, 'DEEP_ARCHIVE');
        });

        mocha.it('should accept ExpiredObjectDeleteMarker together with Transition', async function() {
            await put_rule(archive_bucket, {
                Expiration: { ExpiredObjectDeleteMarker: true },
                Transitions: [{ Days: 12, StorageClass: 'DEEP_ARCHIVE' }],
            });
            const res = await s3.getBucketLifecycleConfiguration({ Bucket: archive_bucket });
            assert.strictEqual(res.Rules[0].Expiration.ExpiredObjectDeleteMarker, true);
            assert.strictEqual(res.Rules[0].Transitions[0].Days, 12);
        });

        mocha.it('should reject NoncurrentVersionTransition that omits StorageClass', async function() {
            await assert_rejected(archive_bucket, {
                NoncurrentVersionTransitions: [{ NoncurrentDays: 1 }],
            }, 'MalformedXML');
        });

        mocha.it('should reject NoncurrentVersionTransition that omits NoncurrentDays', async function() {
            await assert_rejected(archive_bucket, {
                NoncurrentVersionTransitions: [{ StorageClass: 'GLACIER' }],
            }, 'MalformedXML');
        });

        mocha.it('should reject empty NoncurrentVersionTransition action', async function() {
            await assert_rejected(archive_bucket, {
                NoncurrentVersionTransitions: [{}],
            }, 'MalformedXML');
        });

        mocha.it('should reject StorageClass that is not GLACIER or DEEP_ARCHIVE on NoncurrentVersionTransition', async function() {
            await assert_rejected(archive_bucket, {
                NoncurrentVersionTransitions: [{ NoncurrentDays: 1, StorageClass: 'STANDARD_IA' }],
            }, 'MalformedXML');
        });

        mocha.it('should reject duplicate StorageClass in NoncurrentVersionTransitions', async function() {
            await assert_rejected(archive_bucket, {
                NoncurrentVersionTransitions: [
                    { NoncurrentDays: 30, StorageClass: 'DEEP_ARCHIVE' },
                    { NoncurrentDays: 90, StorageClass: 'DEEP_ARCHIVE' },
                ],
            }, 'InvalidRequest',
                `'StorageClass' must be different for 'NoncurrentVersionTransition' actions in same 'Rule' with filter '(prefix=test/)'`);
        });

        mocha.it('should reject duplicate StorageClass before NoncurrentDays ordering', async function() {
            await assert_rejected(archive_bucket, {
                NoncurrentVersionTransitions: [
                    { NoncurrentDays: 90, StorageClass: 'GLACIER' },
                    { NoncurrentDays: 30, StorageClass: 'GLACIER' },
                ],
            }, 'InvalidRequest',
                `'StorageClass' must be different for 'NoncurrentVersionTransition' actions in same 'Rule' with filter '(prefix=test/)'`);
        });

        mocha.it('should include Tag in duplicate StorageClass error text', async function() {
            await assert_rejected(archive_bucket, {
                Filter: { Tag: { Key: 'archive', Value: 'true' } },
                Transitions: [
                    { Days: 30, StorageClass: 'GLACIER' },
                    { Days: 90, StorageClass: 'GLACIER' },
                ],
            }, 'InvalidRequest',
                `'StorageClass' must be different for 'Transition' actions in same 'Rule' with filter '(tag={key=archive, value=true})'`);
        });

        mocha.it('should reject DEEP_ARCHIVE Days that are not greater than GLACIER Days', async function() {
            await assert_rejected(archive_bucket, {
                Filter: {
                    And: { Prefix: 'test/', ObjectSizeLessThan: 120120 },
                },
                Transitions: [
                    { Days: 1, StorageClass: 'DEEP_ARCHIVE' },
                    { Days: 1, StorageClass: 'GLACIER' },
                ],
            }, 'InvalidArgument',
                `'Days' in the Transition action for StorageClass 'DEEP_ARCHIVE' for filter '(prefix=test/ and objectsizelessthan=120120)' must be greater than 'Days' in the Transition action for StorageClass 'GLACIER' for filter '(prefix=test/ and objectsizelessthan=120120)'`);
        });

        mocha.it('should reject DEEP_ARCHIVE Date that is not greater than GLACIER Date', async function() {
            const midnight = new Date('2027-01-01T00:00:00.000Z');
            await assert_rejected(archive_bucket, {
                Transitions: [
                    { Date: midnight, StorageClass: 'GLACIER' },
                    { Date: midnight, StorageClass: 'DEEP_ARCHIVE' },
                ],
            }, 'InvalidArgument',
                `'Date' in the Transition action for StorageClass 'DEEP_ARCHIVE' for filter '(prefix=test/)' must be greater than 'Date' in the Transition action for StorageClass 'GLACIER' for filter '(prefix=test/)'`);
        });

        mocha.it('should reject DEEP_ARCHIVE NoncurrentDays that are not greater than GLACIER NoncurrentDays', async function() {
            await assert_rejected(archive_bucket, {
                NoncurrentVersionTransitions: [
                    { NoncurrentDays: 1, StorageClass: 'GLACIER' },
                    { NoncurrentDays: 1, StorageClass: 'DEEP_ARCHIVE' },
                ],
            }, 'InvalidArgument',
                `'NoncurrentDays' in the NoncurrentVersionTransition action for StorageClass 'DEEP_ARCHIVE' for filter '(prefix=test/)' must be greater than 'NoncurrentDays' in the NoncurrentVersionTransition action for StorageClass 'GLACIER' for filter '(prefix=test/)'`);
        });

        mocha.it('should accept GLACIER then later DEEP_ARCHIVE Transitions in the same rule', async function() {
            await put_rule(archive_bucket, {
                Transitions: [
                    { Days: 30, StorageClass: 'GLACIER' },
                    { Days: 90, StorageClass: 'DEEP_ARCHIVE' },
                ],
            });
            const res = await s3.getBucketLifecycleConfiguration({ Bucket: archive_bucket });
            assert.strictEqual(res.Rules[0].Transitions.length, 2);
            assert.strictEqual(res.Rules[0].Transitions[0].StorageClass, 'GLACIER');
            assert.strictEqual(res.Rules[0].Transitions[1].StorageClass, 'DEEP_ARCHIVE');
        });

        mocha.it('should accept the same StorageClass on Transition and NoncurrentVersionTransition', async function() {
            await put_rule(archive_bucket, {
                Transitions: [{ Days: 1, StorageClass: 'DEEP_ARCHIVE' }],
                NoncurrentVersionTransitions: [{ NoncurrentDays: 1, StorageClass: 'DEEP_ARCHIVE' }],
            });
            const res = await s3.getBucketLifecycleConfiguration({ Bucket: archive_bucket });
            assert.strictEqual(res.Rules[0].Transitions[0].StorageClass, 'DEEP_ARCHIVE');
            assert.strictEqual(res.Rules[0].NoncurrentVersionTransitions[0].StorageClass, 'DEEP_ARCHIVE');
        });

        mocha.it('should accept Date-based Transition at midnight UTC', async function() {
            const midnight = new Date('2026-01-01T00:00:00.000Z');
            await put_rule(archive_bucket, {
                Transitions: [{ Date: midnight, StorageClass: 'GLACIER' }],
            });
            const res = await s3.getBucketLifecycleConfiguration({ Bucket: archive_bucket });
            assert.strictEqual(new Date(res.Rules[0].Transitions[0].Date).getTime(), midnight.getTime());
            assert.strictEqual(res.Rules[0].Transitions[0].StorageClass, 'GLACIER');
        });
    });


    // ──────────────────────────────────────────────────────────────────────
    // NoncurrentVersionTransition filters (prefix, size, tags)
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('NoncurrentVersionTransition filters', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-f';
        const AGE_DAYS = 10;
        const NONCURRENT_DAYS = 1;

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

        mocha.it('should filter by prefix', async function() {
            const ts = Date.now();
            const key_logs_a = `logs/a-${ts}`;
            const key_logs_b = `logs/b-${ts}`;
            const key_data_c = `data/c-${ts}`;

            for (const key of [key_logs_a, key_logs_b, key_data_c]) {
                await create_aged_object(key, bucket, AGE_DAYS);
                await P.delay(50);
                await create_aged_object(key, bucket, AGE_DAYS);
            }

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: NONCURRENT_DAYS,
                prefix: 'logs/',
            });

            const matching_logs = results.filter(o => o.key.startsWith('logs/'));
            const matching_data = results.filter(o => o.key.startsWith('data/'));
            assert(matching_logs.length > 0, 'Expected noncurrent logs/* versions in results');
            assert.strictEqual(matching_data.length, 0,
                'data/* versions should be excluded by prefix filter');
        });

        mocha.it('should filter by size_greater', async function() {
            const ts = Date.now();
            const key_small = `size-small-${ts}`;
            const key_large = `size-large-${ts}`;

            // 2 versions each; noncurrent versions get size filters applied
            await create_aged_object(key_small, bucket, AGE_DAYS, { size: 100 });
            await P.delay(50);
            await create_aged_object(key_small, bucket, AGE_DAYS, { size: 100 });

            await create_aged_object(key_large, bucket, AGE_DAYS, { size: 1000 });
            await P.delay(50);
            await create_aged_object(key_large, bucket, AGE_DAYS, { size: 1000 });

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: NONCURRENT_DAYS,
                size_greater: 500,
            });

            const matching = results.filter(o =>
                o.key === key_small || o.key === key_large);
            for (const obj of matching) {
                assert(obj.size > 500,
                    `Expected size > 500, got ${obj.size} for key ${obj.key}`);
            }
            const small_found = matching.find(o => o.key === key_small);
            assert(!small_found, 'Small object should be excluded by size_greater filter');
        });

        mocha.it('should filter by size_less', async function() {
            const ts = Date.now();
            const key_small = `sizelt-small-${ts}`;
            const key_large = `sizelt-large-${ts}`;

            await create_aged_object(key_small, bucket, AGE_DAYS, { size: 100 });
            await P.delay(50);
            await create_aged_object(key_small, bucket, AGE_DAYS, { size: 100 });

            await create_aged_object(key_large, bucket, AGE_DAYS, { size: 1000 });
            await P.delay(50);
            await create_aged_object(key_large, bucket, AGE_DAYS, { size: 1000 });

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: NONCURRENT_DAYS,
                size_less: 500,
            });

            const matching = results.filter(o =>
                o.key === key_small || o.key === key_large);
            for (const obj of matching) {
                assert(obj.size < 500,
                    `Expected size < 500, got ${obj.size} for key ${obj.key}`);
            }
            const large_found = matching.find(o => o.key === key_large);
            assert(!large_found, 'Large object should be excluded by size_less filter');
        });

        mocha.it('should filter by tags', async function() {
            const ts = Date.now();
            const key_tagged = `tagged-${ts}`;
            const key_untagged = `untagged-${ts}`;

            // 2 versions each
            await create_aged_object(key_tagged, bucket, AGE_DAYS);
            await P.delay(50);
            await create_aged_object(key_tagged, bucket, AGE_DAYS);

            await create_aged_object(key_untagged, bucket, AGE_DAYS);
            await P.delay(50);
            await create_aged_object(key_untagged, bucket, AGE_DAYS);

            // Tag all versions of key_tagged via MDStore (tag the noncurrent one)
            const bucket_obj = get_bucket_from_store(bucket);
            const all_results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: NONCURRENT_DAYS,
            });
            const noncurrent_tagged = all_results.filter(o => o.key === key_tagged);
            for (const obj of noncurrent_tagged) {
                await MDStore.instance().update_object_by_id(obj._id, {
                    tagging: [{ key: 'env', value: 'prod' }],
                });
            }

            const filtered = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: NONCURRENT_DAYS,
                tags: [{ key: 'env', value: 'prod' }],
            });

            const matching_tagged = filtered.filter(o => o.key === key_tagged);
            const matching_untagged = filtered.filter(o => o.key === key_untagged);
            assert(matching_tagged.length > 0, 'Tagged noncurrent versions should be in results');
            assert.strictEqual(matching_untagged.length, 0,
                'Untagged versions should be excluded by tag filter');
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // Versioned Pagination (composite keyset)
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Versioned Pagination', function() {
        this.timeout(120000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-h';
        const AGE_DAYS = 10;
        const NONCURRENT_DAYS = 1;
        const NUM_KEYS = 3;
        const VERSIONS_PER_KEY = 4; // 3 noncurrent each = 9 eligible total
        const SMALL_BATCH = 3;

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

        mocha.it('should paginate through all eligible noncurrent versions', async function() {
            const ts = Date.now();
            const keys = Array.from({ length: NUM_KEYS }, (_, i) =>
                `page-${String(i).padStart(3, '0')}-${ts}`);

            for (const key of keys) {
                for (let v = 0; v < VERSIONS_PER_KEY; v++) {
                    await create_aged_object(key, bucket, AGE_DAYS);
                    await P.delay(50);
                }
            }

            const bucket_obj = get_bucket_from_store(bucket);
            const expected_total = NUM_KEYS * (VERSIONS_PER_KEY - 1); // 9

            let all_results = [];
            let key_marker;
            let version_seq_marker;
            let is_truncated = true;

            while (is_truncated) {
                const batch = await MDStore.instance().find_versioned_objects_to_transition({
                    bucket_id: bucket_obj._id,
                    batch_size: SMALL_BATCH,
                    noncurrent_days: NONCURRENT_DAYS,
                    key_marker,
                    version_seq_marker,
                });

                const matching = batch.filter(o =>
                    keys.some(k => o.key === k));
                all_results = all_results.concat(matching);

                is_truncated = batch.length >= SMALL_BATCH;
                if (batch.length) {
                    const last = batch[batch.length - 1];
                    key_marker = last.key;
                    version_seq_marker = last.version_seq;
                }
            }

            assert.strictEqual(all_results.length, expected_total,
                `Expected ${expected_total} noncurrent versions across pages, got ${all_results.length}`);

            // Verify sort order: key ASC, then version_seq DESC within same key
            for (let i = 1; i < all_results.length; i++) {
                const prev = all_results[i - 1];
                const curr = all_results[i];
                if (prev.key === curr.key) {
                    assert(curr.version_seq < prev.version_seq,
                        `Within key ${prev.key}: version_seq should be DESC, ` +
                        `got ${prev.version_seq} then ${curr.version_seq}`);
                } else {
                    assert(curr.key > prev.key,
                        `Keys should be ASC: ${prev.key} should be before ${curr.key}`);
                }
            }
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // Versioned Concurrency guards
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Versioned Concurrency guards', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-i';
        const AGE_DAYS = 10;
        const NONCURRENT_DAYS = 1;

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

        mocha.it('should skip noncurrent versions with transition_info=IN_PROGRESS', async function() {
            const key = 'guard-v-inprog-' + Date.now();

            // 3 versions: 1 current + 2 noncurrent
            const v1_id = await create_aged_object(key, bucket, AGE_DAYS);
            await P.delay(50);
            await create_aged_object(key, bucket, AGE_DAYS);
            await P.delay(50);
            await create_aged_object(key, bucket, AGE_DAYS);

            // Mark oldest noncurrent (v1) as IN_PROGRESS
            const id = new mongodb.ObjectId(v1_id);
            await MDStore.instance().update_object_by_id(id, {
                transition_info: { status: ARCHIVE.TRANSITION_STATUS.IN_PROGRESS },
            });

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: NONCURRENT_DAYS,
            });

            const matching = results.filter(o => o.key === key);
            const found_v1 = matching.find(o => o._id.toHexString() === v1_id);
            assert(!found_v1,
                'Noncurrent version with transition_info=IN_PROGRESS should be excluded');
            // The other noncurrent version (v2) should still be found
            assert(matching.length >= 1,
                'Other noncurrent versions should still be eligible');
        });

        mocha.it('should skip noncurrent versions with transition_info=DONE', async function() {
            const key = 'guard-v-done-' + Date.now();

            const v1_id = await create_aged_object(key, bucket, AGE_DAYS);
            await P.delay(50);
            await create_aged_object(key, bucket, AGE_DAYS);
            await P.delay(50);
            await create_aged_object(key, bucket, AGE_DAYS);

            const id = new mongodb.ObjectId(v1_id);
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
            const results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: NONCURRENT_DAYS,
            });

            const found_v1 = results.find(o => o._id.toHexString() === v1_id);
            assert(!found_v1,
                'Noncurrent version with transition_info=DONE should be excluded');
        });

        mocha.it('should skip deleted noncurrent versions', async function() {
            const key = 'guard-v-deleted-' + Date.now();

            await create_aged_object(key, bucket, AGE_DAYS);
            await P.delay(50);
            await create_aged_object(key, bucket, AGE_DAYS);

            // Delete creates a delete marker; both prior versions become noncurrent
            // but the delete_marker check in base_conditions filters them
            await rpc_client.object.delete_object({ bucket, key });

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: NONCURRENT_DAYS,
            });

            // Versions should still appear (they are not deleted, the delete marker is separate)
            // but the delete marker itself should not appear
            const delete_markers = results.filter(o => o.key === key && o.delete_marker);
            assert.strictEqual(delete_markers.length, 0,
                'Delete markers should NOT appear in transition results');
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // Multi-key ordering
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Multi-key ordering', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-j';
        const AGE_DAYS = 10;
        const NONCURRENT_DAYS = 1;

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

        mocha.it('should return results sorted by key ASC, version_seq DESC', async function() {
            const ts = Date.now();
            const keys = [`aaa-${ts}`, `bbb-${ts}`, `ccc-${ts}`];

            for (const key of keys) {
                // 3 versions each → 2 noncurrent per key = 6 total
                for (let v = 0; v < 3; v++) {
                    await create_aged_object(key, bucket, AGE_DAYS);
                    await P.delay(50);
                }
            }

            const bucket_obj = get_bucket_from_store(bucket);
            const results = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: NONCURRENT_DAYS,
            });

            const matching = results.filter(o => keys.includes(o.key));
            assert.strictEqual(matching.length, 6,
                `Expected 6 noncurrent versions (2 per key x 3 keys), got ${matching.length}`);

            // Verify sort: key ASC, version_seq DESC within same key
            for (let i = 1; i < matching.length; i++) {
                const prev = matching[i - 1];
                const curr = matching[i];
                if (prev.key === curr.key) {
                    assert(curr.version_seq < prev.version_seq,
                        `Within key ${prev.key}: version_seq should be DESC, ` +
                        `got ${prev.version_seq} then ${curr.version_seq}`);
                } else {
                    assert(curr.key > prev.key,
                        `Keys should be ASC: ${prev.key} should come before ${curr.key}`);
                }
            }
        });
    });

    // ──────────────────────────────────────────────────────────────────────
    // Combined NoncurrentDays + NewerNoncurrentVersions
    // ──────────────────────────────────────────────────────────────────────
    mocha.describe('Combined NoncurrentDays + NewerNoncurrentVersions', function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        const bucket = TRANSITION_BUCKET + '-k';
        const AGE_DAYS = 10;
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

        mocha.it('should require BOTH noncurrent_days AND newer_noncurrent_versions to be met', async function() {
            const key = 'combined-' + Date.now();

            // 5 versions aged 10 days → 4 noncurrent
            for (let i = 0; i < NUM_VERSIONS; i++) {
                await create_aged_object(key, bucket, AGE_DAYS);
                await P.delay(50);
            }

            const bucket_obj = get_bucket_from_store(bucket);

            // Case 1: days threshold too high (15 > 10 age) → 0 eligible
            const results_days_too_high = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: 15,
                newer_noncurrent_versions: 1,
            });
            const matching_high = results_days_too_high.filter(o => o.key === key);
            assert.strictEqual(matching_high.length, 0,
                'No versions should be eligible when noncurrent_days exceeds actual age');

            // Case 2: both conditions met (days=1, retain=1) → 3 eligible
            const results_both_met = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: 1,
                newer_noncurrent_versions: 1,
            });
            const matching_both = results_both_met.filter(o => o.key === key);
            const expected = NUM_VERSIONS - 1 - 1; // 4 noncurrent - 1 retained = 3
            assert.strictEqual(matching_both.length, expected,
                `Expected ${expected} eligible when both conditions met, got ${matching_both.length}`);

            // Case 3: retention too high (retain=10 > 4 noncurrent) → 0 eligible
            const results_retain_high = await MDStore.instance().find_versioned_objects_to_transition({
                bucket_id: bucket_obj._id,
                batch_size: 100,
                noncurrent_days: 1,
                newer_noncurrent_versions: 10,
            });
            const matching_retain = results_retain_high.filter(o => o.key === key);
            assert.strictEqual(matching_retain.length, 0,
                'No versions should be eligible when retention count exceeds noncurrent count');
        });
    });
});
