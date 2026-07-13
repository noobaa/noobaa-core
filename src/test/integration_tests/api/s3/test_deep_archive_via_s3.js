/* Copyright (C) 2026 NooBaa */
/* eslint-disable max-lines-per-function */

'use strict';

// setup coretest first to prepare the env
const coretest = require('../../../utils/coretest/coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });

const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

const config = require('../../../../../config');
const http_utils = require('../../../../util/http_utils');
const s3_utils = require('../../../../endpoint/s3/s3_utils');
const { get_archive_key } = require('../../../../util/deep_archive_utils');
const test_utils = require('../../../system_tests/test_utils');
const { MDStore } = require('../../../../server/object_services/md_store');
const db_client = require('../../../../util/db_client');
const { ObjectsReclaimer } = require('../../../../server/bg_services/objects_reclaimer');
const { BucketsReclaimer } = require('../../../../server/bg_services/buckets_reclaimer');
const lifecycle = require('../../../../server/bg_services/lifecycle');
const commonTests = require('../../../lifecycle/common');
const system_store = require('../../../../server/system_services/system_store').get_instance();

const { rpc_client, EMAIL } = coretest;

const BUCKET = 'test-msc-s3-copy';
const ARCHIVE_TARGET_BUCKET = 'test-msc-s3-copy-archive-target';
const ARCHIVE_CONNECTION = 'msc_s3_copy_archive_connection';
const ARCHIVE_NSR = 'msc_s3_copy_archive_nsr';

/** @type {S3} */
let s3;
let bucket_id;

/**
 * @param {Error & { Code?: string, code?: string, name?: string }} err
 * @returns {string}
 */
function err_code(err) {
    return err.Code || err.code || err.name;
}

/**
 * @param {string} obj_id
 * @returns {nb.ID}
 */
function parse_obj_id(obj_id) {
    return db_client.instance().parse_object_id(obj_id);
}

/**
 * @param {string} bid
 * @param {string} obj_id
 * @returns {Promise<Buffer>}
 */
async function get_archive_body(bid, obj_id) {
    const archived = await s3.getObject({
        Bucket: ARCHIVE_TARGET_BUCKET,
        Key: get_archive_key(bid, obj_id),
    });
    return Buffer.from(await archived.Body.transformToByteArray());
}

/**
 * @param {string} bid
 * @param {string} obj_id
 * @returns {Promise<void>}
 */
async function assert_archive_absent(bid, obj_id) {
    await assert.rejects(
        s3.headObject({ Bucket: ARCHIVE_TARGET_BUCKET, Key: get_archive_key(bid, obj_id) }),
        err => err_code(err) === 'NotFound' || err_code(err) === 'NoSuchKey'
    );
}

/**
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<void>}
 */
async function assert_md_absent(bucket, key) {
    await assert.rejects(
        rpc_client.object.read_object_md({ bucket, key }),
        err => err.rpc_code === 'NO_SUCH_OBJECT'
    );
}

/**
 * @param {string} obj_id
 * @returns {Promise<boolean>}
 */
async function object_has_parts(obj_id) {
    return MDStore.instance().has_any_parts_for_object({ _id: parse_obj_id(obj_id) });
}

/**
 * Soft-deleted MD still exists and is not yet marked reclaimed.
 * Check by id — find_unreclaimed_objects(limit) can miss the object under a
 * shared coretest DB where unreclaimed leftovers fill the limited batch.
 * @param {string} obj_id
 * @returns {Promise<void>}
 */
async function assert_object_unreclaimed(obj_id) {
    const obj = await MDStore.instance().find_object_by_id(parse_obj_id(obj_id));
    assert.ok(obj?.deleted && !obj.reclaimed, 'expected deleted archive object to be unreclaimed');
}

/**
 * @param {string} obj_id
 * @returns {Promise<void>}
 */
async function assert_object_reclaimed(obj_id) {
    const obj = await MDStore.instance().find_object_by_id(parse_obj_id(obj_id));
    assert.ok(obj?.reclaimed, 'expected archive object to be marked reclaimed');
}

/**
 * Drain ObjectsReclaimer until every given object is marked reclaimed.
 * find_unreclaimed_objects is hard-capped at 1000, so one batch is not enough
 * when earlier suites leave a large unreclaimed backlog.
 * @param {...string} obj_ids
 * @returns {Promise<void>}
 */
async function run_objects_reclaimer(...obj_ids) {
    assert.ok(obj_ids.length, 'run_objects_reclaimer requires at least one obj_id');
    const ids = obj_ids.map(parse_obj_id);
    const reclaimer = new ObjectsReclaimer({ name: 'test_object_reclaimer', client: rpc_client });

    for (let i = 0; i < 1000; i++) {
        const objs = await MDStore.instance().find_objects_by_id(ids);
        if (objs.length === ids.length && objs.every(o => o.reclaimed)) return;

        const delay = await reclaimer.run_batch();
        if (delay === config.OBJECT_RECLAIMER_EMPTY_DELAY) break;
    }

    const objs = await MDStore.instance().find_objects_by_id(ids);
    assert.ok(
        objs.length === ids.length && objs.every(o => o.reclaimed),
        `objects not reclaimed: ${obj_ids.join(', ')}`
    );
}

/**
 * Asserts archived object MD and that payload lives under get_archive_key on the archive target.
 * @param {{ key: string, buf: Buffer, storage_class: string, bucket?: string, bid?: string }} args
 * @returns {Promise<void>}
 */
async function assert_archived_via_s3({ key, buf, storage_class, bucket = BUCKET, bid = bucket_id }) {
    const md = await rpc_client.object.read_object_md({ bucket, key });
    assert.strictEqual(md.storage_class, storage_class);
    assert.strictEqual(md.size, buf.length);

    const archived_body = await get_archive_body(bid, md.obj_id);
    assert.strictEqual(Buffer.compare(archived_body, buf), 0);

    await assert.rejects(
        s3.headObject({ Bucket: ARCHIVE_TARGET_BUCKET, Key: key }),
        err => err_code(err) === 'NotFound' || err_code(err) === 'NoSuchKey'
    );

    await assert.rejects(
        s3.getObject({ Bucket: bucket, Key: key }),
        err => err_code(err) === 'InvalidObjectState'
    );
}

/**
 * Puts a DEEP_ARCHIVE object via S3 and returns its md.
 * @param {{ bucket?: string, key: string, buf: Buffer }} args
 * @returns {Promise<object>}
 */
async function put_deep_archive({ bucket = BUCKET, key, buf }) {
    await s3.putObject({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: 'application/octet-stream',
        StorageClass: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
    });
    return rpc_client.object.read_object_md({ bucket, key });
}

/**
 * Puts a STANDARD object via S3 and returns its md.
 * @param {{ bucket?: string, key: string, buf: Buffer }} args
 * @returns {Promise<object>}
 */
async function put_standard({ bucket = BUCKET, key, buf }) {
    await s3.putObject({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: 'application/octet-stream',
        StorageClass: s3_utils.STORAGE_CLASS_STANDARD,
    });
    return rpc_client.object.read_object_md({ bucket, key });
}

/**
 * Simulates an actively restored archive object:
 * STANDARD upload (NB restore copy) + archive payload + MD marked DEEP_ARCHIVE with restore_status.
 * RestoreObject is not implemented yet, so tests seed this state via MDStore.
 * @param {{ bucket?: string, bid?: string, key: string, buf: Buffer }} args
 * @returns {Promise<object>}
 */
async function simulate_put_restored_deep_archive({ bucket = BUCKET, bid = bucket_id, key, buf }) {
    const md = await put_standard({ bucket, key, buf });
    await s3.putObject({
        Bucket: ARCHIVE_TARGET_BUCKET,
        Key: get_archive_key(bid, md.obj_id),
        Body: buf,
        ContentType: 'application/octet-stream',
    });
    await MDStore.instance().update_object_by_id(parse_obj_id(md.obj_id), {
        storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
        restore_status: {
            ongoing: false,
            expiry_time: new Date('2099-01-01T00:00:00Z'),
        },
    });
    return rpc_client.object.read_object_md({ bucket, key });
}

/**
 * Creates a dedicated archive-policy bucket for tests that destroy the bucket.
 * @param {string} name
 * @returns {Promise<string>} bucket id
 */
async function create_archive_bucket(name) {
    await rpc_client.bucket.create_bucket({
        name,
        archive_policy: {
            deep_archive_resource: { resource: ARCHIVE_NSR },
        },
    });
    const info = await rpc_client.bucket.read_bucket_sdk_info({ name });
    return String(info._id);
}

/**
 * Soft-deletes all objects on a deleting bucket, runs ObjectsReclaimer while
 * archive_policy is still available, then finishes BucketsReclaimer.
 * @param {string} bid
 * @param {...string} obj_ids
 * @returns {Promise<void>}
 */
async function reclaim_deleting_bucket(bid, ...obj_ids) {
    const deleting_bucket = system_store.data.buckets.find(
        b => Boolean(b.deleting) && String(b._id) === String(bid)
    );
    assert.ok(deleting_bucket, 'expected bucket to be marked deleting');
    const deleting_name = deleting_bucket.name.unwrap ?
        deleting_bucket.name.unwrap() :
        String(deleting_bucket.name);

    // Soft-delete MD without removing the bucket yet (archive_policy still needed).
    let is_empty = false;
    while (!is_empty) {
        const reply = await rpc_client.object.delete_multiple_objects_unordered({
            bucket: deleting_name,
            limit: config.BUCKET_RECLAIMER_BATCH_SIZE,
        });
        is_empty = reply.is_empty;
    }

    await run_objects_reclaimer(...obj_ids);

    const buckets_reclaimer = new BucketsReclaimer({
        name: 'test_bucket_reclaimer',
        client: rpc_client,
    });
    await buckets_reclaimer.run_batch();

    const bucket_still_present = system_store.data.buckets.some(b => String(b._id) === String(bid));
    assert.ok(!bucket_still_present, 'expected bucket to be removed from system_store');
}

/**
 * Backdates object create_time so an absolute Date lifecycle rule expires it.
 * @param {string} obj_id
 * @param {number} age_days
 * @returns {Promise<void>}
 */
async function backdate_object(obj_id, age_days) {
    const create_time = new Date();
    create_time.setDate(create_time.getDate() - age_days);
    await MDStore.instance().update_object_by_id(parse_obj_id(obj_id), { create_time });
}

mocha.describe('deep_archive_via_s3', function() {
    mocha.before(async function() {
        const account_info = await rpc_client.account.read_account({ email: EMAIL });
        const credentials = {
            accessKeyId: account_info.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
        };
        s3 = new S3({
            endpoint: coretest.get_http_address(),
            credentials,
            forcePathStyle: true,
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpAgent: http_utils.get_unsecured_agent(coretest.get_http_address()),
            }),
        });

        config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = false;
        await s3.createBucket({ Bucket: ARCHIVE_TARGET_BUCKET });
        await rpc_client.account.add_external_connection({
            name: ARCHIVE_CONNECTION,
            endpoint: coretest.get_http_address(),
            endpoint_type: 'S3_COMPATIBLE',
            auth_method: 'AWS_V4',
            identity: credentials.accessKeyId,
            secret: credentials.secretAccessKey,
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
        const bucket_info = await rpc_client.bucket.read_bucket_sdk_info({ name: BUCKET });
        bucket_id = String(bucket_info._id);
    });

    mocha.after(async function() {
        try {
            await test_utils.empty_and_delete_buckets(rpc_client, [BUCKET]);
            await rpc_client.pool.delete_namespace_resource({ name: ARCHIVE_NSR });
            await rpc_client.account.delete_external_connection({ connection_name: ARCHIVE_CONNECTION });
            await test_utils.empty_and_delete_buckets(rpc_client, [ARCHIVE_TARGET_BUCKET]);
        } finally {
            config.ARCHIVE_TARGET_BUCKET_CHECK_ENABLED = true;
        }
    });

    mocha.describe('PutObject', function() {

    mocha.it('puts STANDARD objects and allows reading via getObject', async function() {
        const key = 's3-put/standard';
        const buf = crypto.randomBytes(64);

        const put_res = await s3.putObject({
            Bucket: BUCKET,
            Key: key,
            Body: buf,
            ContentType: 'application/octet-stream',
            StorageClass: s3_utils.STORAGE_CLASS_STANDARD,
        });
        assert.ok(put_res.ETag);

        const md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });
        assert.strictEqual(md.size, buf.length);
        assert.ok(!md.storage_class || md.storage_class === s3_utils.STORAGE_CLASS_STANDARD);

        const get_res = await s3.getObject({ Bucket: BUCKET, Key: key });
        const body = Buffer.from(await get_res.Body.transformToByteArray());
        assert.strictEqual(Buffer.compare(body, buf), 0);
    });

    mocha.it('defaults to STANDARD when StorageClass is unset', async function() {
        const key = 's3-put/default-sc';
        const buf = crypto.randomBytes(32);

        await s3.putObject({
            Bucket: BUCKET,
            Key: key,
            Body: buf,
            ContentType: 'application/octet-stream',
        });

        const md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });
        assert.strictEqual(md.size, buf.length);
        assert.ok(!md.storage_class || md.storage_class === s3_utils.STORAGE_CLASS_STANDARD);

        const get_res = await s3.getObject({ Bucket: BUCKET, Key: key });
        const body = Buffer.from(await get_res.Body.transformToByteArray());
        assert.strictEqual(Buffer.compare(body, buf), 0);
    });

    mocha.it('puts object with StorageClass=DEEP_ARCHIVE', async function() {
        const key = 's3-put/deep-archive';
        const buf = Buffer.from('deep-archive-payload');

        await s3.putObject({
            Bucket: BUCKET,
            Key: key,
            Body: buf,
            ContentType: 'application/octet-stream',
            StorageClass: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
        });

        await assert_archived_via_s3({
            key,
            buf,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
        });
    });

    mocha.it('puts object with StorageClass=GLACIER', async function() {
        const key = 's3-put/glacier';
        const buf = Buffer.from('glacier-payload');

        await s3.putObject({
            Bucket: BUCKET,
            Key: key,
            Body: buf,
            ContentType: 'application/octet-stream',
            StorageClass: s3_utils.STORAGE_CLASS_GLACIER,
        });

        await assert_archived_via_s3({
            key,
            buf,
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
        });
    });

    mocha.it('rejects StorageClass=GLACIER_IR with NotImplemented', async function() {
        await assert.rejects(
            s3.putObject({
                Bucket: BUCKET,
                Key: 's3-put/glacier-ir',
                Body: Buffer.from('x'),
                ContentType: 'application/octet-stream',
                StorageClass: s3_utils.STORAGE_CLASS_GLACIER_IR,
            }),
            err => err_code(err) === 'NotImplemented'
        );
    });

    }); // PutObject

    mocha.describe('CopyObject', function() {

    mocha.it('copies STANDARD → STANDARD via s3.copyObject', async function() {
        const source_key = 's3-copy/std-to-std-src';
        const dest_key = 's3-copy/std-to-std-dst';
        const body = 's3-copy-std-payload';

        await s3.putObject({
            Bucket: BUCKET,
            Key: source_key,
            Body: body,
            ContentType: 'application/octet-stream',
        });

        const copy_res = await s3.copyObject({
            Bucket: BUCKET,
            Key: dest_key,
            CopySource: `/${BUCKET}/${source_key}`,
            StorageClass: s3_utils.STORAGE_CLASS_STANDARD,
        });
        assert.ok(copy_res.CopyObjectResult?.ETag || copy_res.$metadata.httpStatusCode === 200);

        const get_res = await s3.getObject({ Bucket: BUCKET, Key: dest_key });
        const copied_body = await get_res.Body.transformToString();
        assert.strictEqual(copied_body, body);
        assert.ok(!get_res.StorageClass || get_res.StorageClass === s3_utils.STORAGE_CLASS_STANDARD);
    });

    mocha.it('copies STANDARD → DEEP_ARCHIVE via s3.copyObject', async function() {
        const source_key = 's3-copy/std-to-archive-src';
        const dest_key = 's3-copy/std-to-archive-dst';
        const buf = Buffer.from('s3-copy-to-deep-archive');

        await s3.putObject({
            Bucket: BUCKET,
            Key: source_key,
            Body: buf,
            ContentType: 'application/octet-stream',
        });

        await s3.copyObject({
            Bucket: BUCKET,
            Key: dest_key,
            CopySource: `/${BUCKET}/${source_key}`,
            StorageClass: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
        });

        await assert_archived_via_s3({
            key: dest_key,
            buf,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
        });
    });

    mocha.it('copies STANDARD → GLACIER via s3.copyObject', async function() {
        const source_key = 's3-copy/std-to-glacier-src';
        const dest_key = 's3-copy/std-to-glacier-dst';
        const buf = Buffer.from('s3-copy-to-glacier');

        await s3.putObject({
            Bucket: BUCKET,
            Key: source_key,
            Body: buf,
            ContentType: 'application/octet-stream',
        });

        await s3.copyObject({
            Bucket: BUCKET,
            Key: dest_key,
            CopySource: `/${BUCKET}/${source_key}`,
            StorageClass: s3_utils.STORAGE_CLASS_GLACIER,
        });

        await assert_archived_via_s3({
            key: dest_key,
            buf,
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
        });
    });

    mocha.it('rejects s3.copyObject from an unrestored archive source with InvalidObjectState', async function() {
        const source_key = 's3-copy/unrestored-src';
        const dest_key = 's3-copy/unrestored-dst';
        const body = 's3-unrestored';

        await s3.putObject({
            Bucket: BUCKET,
            Key: source_key,
            Body: body,
            ContentType: 'application/octet-stream',
            StorageClass: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
        });

        await assert.rejects(
            s3.copyObject({
                Bucket: BUCKET,
                Key: dest_key,
                CopySource: `/${BUCKET}/${source_key}`,
                StorageClass: s3_utils.STORAGE_CLASS_STANDARD,
            }),
            err => err_code(err) === 'InvalidObjectState'
        );

        await assert.rejects(
            s3.headObject({ Bucket: BUCKET, Key: dest_key }),
            err => err_code(err) === 'NotFound' || err_code(err) === 'NoSuchKey'
        );
    });

    }); // CopyObject

    mocha.describe('DeleteObject', function() {
        this.timeout(120000); // eslint-disable-line no-invalid-this

        mocha.it('deleteObject on DEEP_ARCHIVE removes MD immediately but leaves archive data until reclaim', async function() {
            const key = 's3-delete/deep-archive';
            const buf = Buffer.from('delete-deep-archive-payload');
            const md = await put_deep_archive({ key, buf });
            const obj_id = md.obj_id;

            await s3.deleteObject({ Bucket: BUCKET, Key: key });

            await assert_md_absent(BUCKET, key);
            const archived_body = await get_archive_body(bucket_id, obj_id);
            assert.strictEqual(Buffer.compare(archived_body, buf), 0);
            await assert_object_unreclaimed(obj_id);

            await run_objects_reclaimer(obj_id);

            await assert_archive_absent(bucket_id, obj_id);
            await assert_object_reclaimed(obj_id);
        });

        mocha.it('deleteObject on restored DEEP_ARCHIVE cleans restore copy and archive on reclaim', async function() {
            const key = 's3-delete/restored-deep-archive';
            const buf = Buffer.from('delete-restored-archive-payload');
            const md = await simulate_put_restored_deep_archive({ key, buf });
            const obj_id = md.obj_id;
            const has_parts_before = await object_has_parts(obj_id);
            assert.ok(has_parts_before, 'expected restore copy parts before delete');

            await s3.deleteObject({ Bucket: BUCKET, Key: key });

            await assert_md_absent(BUCKET, key);
            const has_parts_after_delete = await object_has_parts(obj_id);
            assert.ok(has_parts_after_delete, 'restore copy parts remain until reclaim');
            const archived_body = await get_archive_body(bucket_id, obj_id);
            assert.strictEqual(Buffer.compare(archived_body, buf), 0);

            await run_objects_reclaimer(obj_id);

            await assert_archive_absent(bucket_id, obj_id);
            const has_parts_after_reclaim = await object_has_parts(obj_id);
            assert.ok(!has_parts_after_reclaim, 'expected restore copy parts deleted on reclaim');
            await assert_object_reclaimed(obj_id);
        });
    });

    mocha.describe('DeleteMultipleObjects', function() {
        this.timeout(120000); // eslint-disable-line no-invalid-this

        mocha.it('deleteObjects mixes STANDARD and DEEP_ARCHIVE; archive cleaned on reclaim', async function() {
            const std_key = 's3-mdelete/standard';
            const arch_key = 's3-mdelete/deep-archive';
            const std_buf = Buffer.from('mdelete-standard');
            const arch_buf = Buffer.from('mdelete-deep-archive');

            const std_md = await put_standard({ key: std_key, buf: std_buf });
            const arch_md = await put_deep_archive({ key: arch_key, buf: arch_buf });

            const delete_res = await s3.deleteObjects({
                Bucket: BUCKET,
                Delete: {
                    Objects: [{ Key: std_key }, { Key: arch_key }],
                    Quiet: false,
                },
            });
            assert.strictEqual((delete_res.Deleted || []).length, 2);
            const delete_errors = delete_res.Errors || [];
            assert.strictEqual(delete_errors.length, 0);

            await assert_md_absent(BUCKET, std_key);
            await assert_md_absent(BUCKET, arch_key);
            const archived_body = await get_archive_body(bucket_id, arch_md.obj_id);
            assert.strictEqual(Buffer.compare(archived_body, arch_buf), 0);

            await run_objects_reclaimer(std_md.obj_id, arch_md.obj_id);

            await assert_archive_absent(bucket_id, arch_md.obj_id);
            await assert_object_reclaimed(std_md.obj_id);
            await assert_object_reclaimed(arch_md.obj_id);
        });

        mocha.it('deleteObjects mixes STANDARD and restored DEEP_ARCHIVE; both copies cleaned on reclaim', async function() {
            const std_key = 's3-mdelete/std-with-restored';
            const arch_key = 's3-mdelete/restored-deep-archive';
            const std_buf = Buffer.from('mdelete-std-restored-mix');
            const arch_buf = Buffer.from('mdelete-restored-archive');

            const std_md = await put_standard({ key: std_key, buf: std_buf });
            const arch_md = await simulate_put_restored_deep_archive({ key: arch_key, buf: arch_buf });
            const has_parts_before = await object_has_parts(arch_md.obj_id);
            assert.ok(has_parts_before);

            await s3.deleteObjects({
                Bucket: BUCKET,
                Delete: {
                    Objects: [{ Key: std_key }, { Key: arch_key }],
                    Quiet: true,
                },
            });

            await assert_md_absent(BUCKET, std_key);
            await assert_md_absent(BUCKET, arch_key);
            const has_parts_after_delete = await object_has_parts(arch_md.obj_id);
            assert.ok(has_parts_after_delete);
            await get_archive_body(bucket_id, arch_md.obj_id);

            await run_objects_reclaimer(std_md.obj_id, arch_md.obj_id);

            await assert_archive_absent(bucket_id, arch_md.obj_id);
            const arch_has_parts = await object_has_parts(arch_md.obj_id);
            const std_has_parts = await object_has_parts(std_md.obj_id);
            assert.ok(!arch_has_parts);
            assert.ok(!std_has_parts);
            await assert_object_reclaimed(std_md.obj_id);
            await assert_object_reclaimed(arch_md.obj_id);
        });
    });

    mocha.describe('Bucket reclaim', function() {
        this.timeout(120000); // eslint-disable-line no-invalid-this

        mocha.it('reclaims bucket with STANDARD and DEEP_ARCHIVE objects', async function() {
            const name = `test-s3-bucket-reclaim-${Date.now()}`;
            const bid = await create_archive_bucket(name);
            const std_key = 'breclaim/standard';
            const arch_key = 'breclaim/deep-archive';
            const std_buf = Buffer.from('bucket-reclaim-standard');
            const arch_buf = Buffer.from('bucket-reclaim-deep-archive');

            const std_md = await put_standard({ bucket: name, key: std_key, buf: std_buf });
            const arch_md = await put_deep_archive({ bucket: name, key: arch_key, buf: arch_buf });
            await assert_archived_via_s3({
                bucket: name,
                bid,
                key: arch_key,
                buf: arch_buf,
                storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            });

            await rpc_client.bucket.delete_bucket_and_objects({ name });
            await reclaim_deleting_bucket(bid, std_md.obj_id, arch_md.obj_id);

            await assert_archive_absent(bid, arch_md.obj_id);
            await assert_object_reclaimed(std_md.obj_id);
            await assert_object_reclaimed(arch_md.obj_id);
        });

        mocha.it('reclaims bucket with STANDARD and restored DEEP_ARCHIVE objects', async function() {
            const name = `test-s3-bucket-reclaim-restored-${Date.now()}`;
            const bid = await create_archive_bucket(name);
            const std_key = 'breclaim/std';
            const arch_key = 'breclaim/restored';
            const std_buf = Buffer.from('bucket-reclaim-std-restored');
            const arch_buf = Buffer.from('bucket-reclaim-restored-archive');

            const std_md = await put_standard({ bucket: name, key: std_key, buf: std_buf });
            const arch_md = await simulate_put_restored_deep_archive({ bucket: name, bid, key: arch_key, buf: arch_buf });
            const has_parts_before = await object_has_parts(arch_md.obj_id);
            assert.ok(has_parts_before);

            await rpc_client.bucket.delete_bucket_and_objects({ name });
            await reclaim_deleting_bucket(bid, std_md.obj_id, arch_md.obj_id);

            await assert_archive_absent(bid, arch_md.obj_id);
            const arch_has_parts = await object_has_parts(arch_md.obj_id);
            const std_has_parts = await object_has_parts(std_md.obj_id);
            assert.ok(!arch_has_parts);
            assert.ok(!std_has_parts);
            await assert_object_reclaimed(std_md.obj_id);
            await assert_object_reclaimed(arch_md.obj_id);
        });
    });

    mocha.describe('Lifecycle expiry', function() {
        this.timeout(120000); // eslint-disable-line no-invalid-this

        mocha.before(function() {
            config.LIFECYCLE_SCHEDULE_MIN = 0;
            config.LIFECYCLE_INTERVAL = 0;
        });

        mocha.it('lifecycle expiry soft-deletes DEEP_ARCHIVE; reclaim removes archive data', async function() {
            const prefix = `s3-lifecycle/da-${Date.now()}`;
            const key = `${prefix}/obj`;
            const buf = Buffer.from('lifecycle-deep-archive');
            const md = await put_deep_archive({ key, buf });
            await backdate_object(md.obj_id, 17);

            await s3.putBucketLifecycleConfiguration(commonTests.date_lifecycle_configuration(BUCKET, prefix));
            await lifecycle.background_worker();

            await assert_md_absent(BUCKET, key);
            const archived_body = await get_archive_body(bucket_id, md.obj_id);
            assert.strictEqual(Buffer.compare(archived_body, buf), 0);

            await run_objects_reclaimer(md.obj_id);
            await assert_archive_absent(bucket_id, md.obj_id);
        });

        mocha.it('lifecycle expiry on restored DEEP_ARCHIVE cleans restore copy and archive on reclaim', async function() {
            const prefix = `s3-lifecycle/restored-${Date.now()}`;
            const key = `${prefix}/obj`;
            const buf = Buffer.from('lifecycle-restored-archive');
            const md = await simulate_put_restored_deep_archive({ key, buf });
            const has_parts_before = await object_has_parts(md.obj_id);
            assert.ok(has_parts_before);
            await backdate_object(md.obj_id, 17);

            await s3.putBucketLifecycleConfiguration(commonTests.date_lifecycle_configuration(BUCKET, prefix));
            await lifecycle.background_worker();

            await assert_md_absent(BUCKET, key);
            const has_parts_after_expiry = await object_has_parts(md.obj_id);
            assert.ok(has_parts_after_expiry);
            await get_archive_body(bucket_id, md.obj_id);

            await run_objects_reclaimer(md.obj_id);

            await assert_archive_absent(bucket_id, md.obj_id);
            const has_parts_after_reclaim = await object_has_parts(md.obj_id);
            assert.ok(!has_parts_after_reclaim);
        });
    });

    // TODO: add GetObject tests (STANDARD read, unrestored / ongoing / expired restore →
    // InvalidObjectState, restored archive read) once RestoreObject is implemented.
});
