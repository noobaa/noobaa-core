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
const { err_code } = test_utils;
const { MDStore } = require('../../../../server/object_services/md_store');
const db_client = require('../../../../util/db_client');
const { ObjectsReclaimer } = require('../../../../server/bg_services/objects_reclaimer');
const { BucketsReclaimer } = require('../../../../server/bg_services/buckets_reclaimer');
const lifecycle = require('../../../../server/bg_services/lifecycle');
const commonTests = require('../../../lifecycle/common');
const system_store = require('../../../../server/system_services/system_store').get_instance();

const { rpc_client, EMAIL } = coretest;

const BUCKET = 'test-msc-s3-copy';
// Soft-delete can take many batches because leftover unreclaimed objects from
// other suites fill the capped reclaimer queue. Bucket removal after objects
// are gone is usually a few batches.
const MAX_SOFT_DELETE_BATCHES = 1000;
const MAX_BUCKET_DELETE_BATCHES = 100;
const ARCHIVE_TARGET_BUCKET = 'test-msc-s3-copy-archive-target';
const ARCHIVE_CONNECTION = 'msc_s3_copy_archive_connection';
const ARCHIVE_NSR = 'msc_s3_copy_archive_nsr';

/** @type {S3} */
let s3;
let bucket_id;

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
 * @param {number} expected_len
 * @returns {Promise<void>}
 */
async function assert_archive_present(bid, obj_id, expected_len) {
    // Use HeadObject — GetObject on unrestored DEEP_ARCHIVE archive keys returns InvalidObjectState.
    const archived_head = await s3.headObject({
        Bucket: ARCHIVE_TARGET_BUCKET,
        Key: get_archive_key(bid, obj_id),
    });
    assert.strictEqual(archived_head.ContentLength, expected_len);
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
 * Starts an archive-class MPU, uploads one part, and returns the NooBaa object id
 * together with the archive-side key and upload id.
 * @param {{ bucket?: string, bid?: string, key: string, storage_class: string }} args
 * @returns {Promise<{ obj_id: string, archive_key: string, upload_id: string }>}
 */
async function start_incomplete_archive_mpu({ bucket = BUCKET, bid = bucket_id, key, storage_class }) {
    const create_res = await s3.createMultipartUpload({
        Bucket: bucket,
        Key: key,
        ContentType: 'application/octet-stream',
        StorageClass: storage_class,
    });
    const obj_id = create_res.UploadId;
    const md = await rpc_client.object.read_object_md({
        bucket,
        key,
        obj_id,
    });
    assert.ok(md.target_data_info?.upload_id, 'expected archive MPU upload_id on object MD');
    await s3.uploadPart({
        Bucket: bucket,
        Key: key,
        UploadId: obj_id,
        PartNumber: 1,
        Body: crypto.randomBytes(64),
    });
    return {
        obj_id,
        archive_key: get_archive_key(bid, obj_id),
        upload_id: md.target_data_info.upload_id,
    };
}

/**
 * @param {string} archive_key
 * @param {string} upload_id
 * @returns {Promise<void>}
 */
async function assert_archive_mpu_present(archive_key, upload_id) {
    const listed = await s3.listParts({
        Bucket: ARCHIVE_TARGET_BUCKET,
        Key: archive_key,
        UploadId: upload_id,
    });
    assert.ok((listed.Parts || []).length >= 1, 'expected archive MPU to still have parts');
}

/**
 * @param {string} archive_key
 * @param {string} upload_id
 * @returns {Promise<void>}
 */
async function assert_archive_mpu_absent(archive_key, upload_id) {
    await assert.rejects(
        s3.listParts({
            Bucket: ARCHIVE_TARGET_BUCKET,
            Key: archive_key,
            UploadId: upload_id,
        }),
        err => err_code(err) === 'NoSuchUpload'
    );
}

/**
 * Asserts archived object MD and that payload lives under get_archive_key on the archive target.
 * @param {{ key: string, buf: Buffer, storage_class: string, bucket?: string, version_id?: string }} args
 * @returns {Promise<void>}
 */
async function assert_archived_via_s3({ key, buf, storage_class, bucket = BUCKET, version_id }) {
    const md = await rpc_client.object.read_object_md({ bucket, key, version_id });
    assert.strictEqual(md.storage_class, storage_class);
    assert.strictEqual(md.size, buf.length);
    const bucket_md = await rpc_client.bucket.read_bucket_sdk_info({ name: bucket });

    const archive_key = get_archive_key(bucket_md._id, md.obj_id);
    const archived_head = await s3.headObject({ Bucket: ARCHIVE_TARGET_BUCKET, Key: archive_key });
    assert.strictEqual(archived_head.StorageClass, storage_class);
    assert.strictEqual(archived_head.ContentLength, buf.length);

    await assert.rejects(
        s3.getObject({ Bucket: ARCHIVE_TARGET_BUCKET, Key: archive_key }),
        err => err_code(err) === 'InvalidObjectState'
    );

    await assert.rejects(
        s3.headObject({ Bucket: ARCHIVE_TARGET_BUCKET, Key: key }),
        err => err_code(err) === 'NotFound' || err_code(err) === 'NoSuchKey'
    );

    await assert.rejects(
        s3.getObject({ Bucket: bucket, Key: key, VersionId: version_id }),
        err => err_code(err) === 'InvalidObjectState'
    );
}

/**
 * Puts an archive storage-class object via S3 and returns its md.
 * @param {{ bucket?: string, key: string, buf: Buffer, storage_class: string }} args
 * @returns {Promise<object>}
 */
async function put_archive({ bucket = BUCKET, key, buf, storage_class }) {
    await s3.putObject({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: 'application/octet-stream',
        StorageClass: storage_class,
    });
    return rpc_client.object.read_object_md({ bucket, key });
}

/**
 * Puts a DEEP_ARCHIVE object via S3 and returns its md.
 * @param {{ bucket?: string, key: string, buf: Buffer }} args
 * @returns {Promise<object>}
 */
async function put_deep_archive({ bucket = BUCKET, key, buf }) {
    return put_archive({
        bucket,
        key,
        buf,
        storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
    });
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
 * Drive BucketsReclaimer + ObjectsReclaimer like production bg workers until the
 * deleting bucket is removed and the given objects are marked reclaimed.
 * BucketsReclaimer soft-deletes objects and keeps archive buckets until
 * ObjectsReclaimer finishes remote archive deletes.
 * @param {string} bid
 * @param {...string} obj_ids
 * @returns {Promise<void>}
 */
async function reclaim_deleting_bucket(bid, ...obj_ids) {
    assert.ok(obj_ids.length, 'reclaim_deleting_bucket requires at least one obj_id');
    const ids = obj_ids.map(parse_obj_id);
    const objects_reclaimer = new ObjectsReclaimer({
        name: 'test_object_reclaimer',
        client: rpc_client,
    });
    const buckets_reclaimer = new BucketsReclaimer({
        name: 'test_bucket_reclaimer',
        client: rpc_client,
    });

    for (let i = 0; i < 1000; i++) {
        await buckets_reclaimer.run_batch();
        await objects_reclaimer.run_batch();

        const bucket_gone = !system_store.data.buckets.some(b => String(b._id) === String(bid));
        const objs = await MDStore.instance().find_objects_by_id(ids);
        if (bucket_gone && objs.length === ids.length && objs.every(o => o.reclaimed)) {
            return;
        }
    }

    const bucket_gone = !system_store.data.buckets.some(b => String(b._id) === String(bid));
    const objs = await MDStore.instance().find_objects_by_id(ids);
    assert.ok(bucket_gone, 'expected bucket to be removed from system_store');
    assert.ok(
        objs.length === ids.length && objs.every(o => o.reclaimed),
        `objects not reclaimed: ${obj_ids.join(', ')}`
    );
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

        await s3.putObject({ Bucket: BUCKET, Key: key, Body: buf, ContentType: 'application/octet-stream' });

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
        const storage_class = s3_utils.STORAGE_CLASS_DEEP_ARCHIVE;
        await s3.putObject({ Bucket: BUCKET, Key: key, Body: buf, StorageClass: storage_class, ContentType: 'application/octet-stream' });
        await assert_archived_via_s3({ key, buf, storage_class });
    });

    mocha.it('puts object with StorageClass=GLACIER', async function() {
        const key = 's3-put/glacier';
        const buf = Buffer.from('glacier-payload');
        const storage_class = s3_utils.STORAGE_CLASS_GLACIER;
        await s3.putObject({ Bucket: BUCKET, Key: key, Body: buf, StorageClass: storage_class, ContentType: 'application/octet-stream' });
        await assert_archived_via_s3({ key, buf, storage_class });
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
            await assert_archive_present(bucket_id, obj_id, buf.length);
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
            await assert_archive_present(bucket_id, obj_id, buf.length);

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
            await assert_archive_present(bucket_id, arch_md.obj_id, arch_buf.length);

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
            await assert_archive_present(bucket_id, arch_md.obj_id, arch_buf.length);

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

        mocha.it('keeps archive bucket until unreclaimed objects are cleared', async function() {
            for (const storage_class of s3_utils.GLACIER_STORAGE_CLASSES) {
                const name = `test-s3-bucket-reclaim-wait-${storage_class.toLowerCase().replaceAll('_', '-')}-${Date.now()}`;
                const bid = await create_archive_bucket(name);
                const arch_key = `breclaim/wait-${storage_class}`;
                const arch_buf = Buffer.from(`bucket-reclaim-wait-${storage_class}`);

                const arch_md = await put_archive({
                    bucket: name,
                    key: arch_key,
                    buf: arch_buf,
                    storage_class,
                });
                await assert_archived_via_s3({
                    bucket: name,
                    key: arch_key,
                    buf: arch_buf,
                    storage_class,
                });

                await rpc_client.bucket.delete_bucket_and_objects({ name });

                const buckets_reclaimer = new BucketsReclaimer({
                    name: 'test_bucket_reclaimer',
                    client: rpc_client,
                });

                // Soft-delete live objects only — do not run ObjectsReclaimer yet.
                for (let i = 0; i < 1000; i++) {
                    await buckets_reclaimer.run_batch();
                    const has_live = await MDStore.instance().has_any_objects_for_bucket(parse_obj_id(bid));
                    if (!has_live) break;
                }
                const has_live = await MDStore.instance().has_any_objects_for_bucket(parse_obj_id(bid));
                assert.ok(!has_live, `expected BucketsReclaimer to soft-delete all live objects (${storage_class})`);
                await assert_object_unreclaimed(arch_md.obj_id);
                await assert_archive_present(bid, arch_md.obj_id, arch_buf.length);

                assert.ok(
                    system_store.data.buckets.some(b => String(b._id) === String(bid)),
                    `archive bucket must remain while unreclaimed ${storage_class} objects exist`
                );
                // Extra BucketsReclaimer passes must still wait on ObjectsReclaimer.
                await buckets_reclaimer.run_batch();
                assert.ok(
                    system_store.data.buckets.some(b => String(b._id) === String(bid)),
                    `BucketsReclaimer must not remove archive bucket with unreclaimed ${storage_class} objects`
                );

                await run_objects_reclaimer(arch_md.obj_id);
                await assert_object_reclaimed(arch_md.obj_id);
                await assert_archive_absent(bid, arch_md.obj_id);

                let bucket_gone = false;
                for (let i = 0; i < 100; i++) {
                    await buckets_reclaimer.run_batch();
                    if (!system_store.data.buckets.some(b => String(b._id) === String(bid))) {
                        bucket_gone = true;
                        break;
                    }
                }
                assert.ok(
                    bucket_gone,
                    `expected bucket removed after unreclaimed ${storage_class} objects were cleared`
                );
            }
        });

        mocha.it('does not wait on unreclaimed STANDARD objects before removing archive bucket', async function() {
            const name = `test-s3-bucket-reclaim-std-only-${Date.now()}`;
            const bid = await create_archive_bucket(name);
            const std_key = 'breclaim/standard-only';
            const std_buf = Buffer.from('bucket-reclaim-standard-only');

            const std_md = await put_standard({ bucket: name, key: std_key, buf: std_buf });

            await rpc_client.bucket.delete_bucket_and_objects({ name });

            const buckets_reclaimer = new BucketsReclaimer({
                name: 'test_bucket_reclaimer',
                client: rpc_client,
            });

            // Soft-delete only — leave STANDARD unreclaimed. Archive wait must not apply.
            for (let i = 0; i < 1000; i++) {
                await buckets_reclaimer.run_batch();
                if (!system_store.data.buckets.some(b => String(b._id) === String(bid))) {
                    await assert_object_unreclaimed(std_md.obj_id);
                    return;
                }
            }
            assert.fail('expected archive bucket removed despite unreclaimed STANDARD object');
        });

        mocha.it('aborts incomplete archive MPU on bucket delete via ObjectsReclaimer', async function() {
            for (const storage_class of s3_utils.GLACIER_STORAGE_CLASSES) {
                const name = `test-s3-bucket-reclaim-mpu-${Date.now()}`;
                const bid = await create_archive_bucket(name);
                const key = `breclaim/incomplete-mpu-${storage_class}`;
                const { obj_id, archive_key, upload_id } = await start_incomplete_archive_mpu({
                    bucket: name,
                    bid,
                    key,
                    storage_class,
                });
                await assert_archive_mpu_present(archive_key, upload_id);

                await rpc_client.bucket.delete_bucket_and_objects({ name });

                const buckets_reclaimer = new BucketsReclaimer({
                    name: 'test_bucket_reclaimer',
                    client: rpc_client,
                });
                for (let i = 0; i < MAX_SOFT_DELETE_BATCHES; i++) {
                    await buckets_reclaimer.run_batch();
                    const has_live = await MDStore.instance().has_any_objects_for_bucket(parse_obj_id(bid));
                    if (!has_live) break;
                }
                const has_live = await MDStore.instance().has_any_objects_for_bucket(parse_obj_id(bid));
                assert.ok(!has_live, `expected BucketsReclaimer to soft-delete incomplete ${storage_class} MPU`);
                await assert_object_unreclaimed(obj_id);
                await assert_archive_mpu_present(archive_key, upload_id);
                assert.ok(
                    system_store.data.buckets.some(b => String(b._id) === String(bid)),
                    `archive bucket must remain while unreclaimed incomplete ${storage_class} MPU exists`
                );

                await run_objects_reclaimer(obj_id);
                await assert_object_reclaimed(obj_id);
                await assert_archive_mpu_absent(archive_key, upload_id);

                let bucket_gone = false;
                for (let i = 0; i < MAX_BUCKET_DELETE_BATCHES; i++) {
                    await buckets_reclaimer.run_batch();
                    if (!system_store.data.buckets.some(b => String(b._id) === String(bid))) {
                        bucket_gone = true;
                        break;
                    }
                }
                assert.ok(
                    bucket_gone,
                    `expected bucket removed after incomplete ${storage_class} MPU was aborted`
                );
            }
        });
    });

    mocha.describe('Lifecycle expiry', function() {
        this.timeout(120000); // eslint-disable-line no-invalid-this

        let original_schedule_min;
        let original_interval;

        mocha.before(function() {
            original_schedule_min = config.LIFECYCLE_SCHEDULE_MIN;
            original_interval = config.LIFECYCLE_INTERVAL;
            config.LIFECYCLE_SCHEDULE_MIN = 0;
            config.LIFECYCLE_INTERVAL = 0;
        });

        mocha.after(function() {
            config.LIFECYCLE_SCHEDULE_MIN = original_schedule_min;
            config.LIFECYCLE_INTERVAL = original_interval;
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
            await assert_archive_present(bucket_id, md.obj_id, buf.length);

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
            await assert_archive_present(bucket_id, md.obj_id, buf.length);

            await run_objects_reclaimer(md.obj_id);

            await assert_archive_absent(bucket_id, md.obj_id);
            const has_parts_after_reclaim = await object_has_parts(md.obj_id);
            assert.ok(!has_parts_after_reclaim);
        });
    });
    mocha.describe('MultipartUpload', function() {
        this.timeout(120000); // eslint-disable-line no-invalid-this

        /**
         * Runs create → uploadPart(s) → complete for the given storage class.
         * @param {{ key: string, parts: Buffer[], storage_class?: string }} args
         * @returns {Promise<{ upload_id: string, etag: string, version_id?: string }>}
         */
        async function multipart_upload({ bucket = BUCKET, key, parts, storage_class }) {
            const create_res = await s3.createMultipartUpload({
                Bucket: bucket,
                Key: key,
                ContentType: 'application/octet-stream',
                StorageClass: storage_class,
            });
            const upload_id = create_res.UploadId;
            assert.ok(upload_id);

            const completed_parts = [];
            for (let i = 0; i < parts.length; ++i) {
                const part_res = await s3.uploadPart({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                    PartNumber: i + 1,
                    Body: parts[i],
                    ContentLength: parts[i].length,
                });
                completed_parts.push({
                    ETag: part_res.ETag,
                    PartNumber: i + 1,
                });
            }

            const complete_res = await s3.completeMultipartUpload({
                Bucket: BUCKET,
                Key: key,
                UploadId: upload_id,
                MultipartUpload: { Parts: completed_parts },
            });
            return { upload_id, etag: complete_res.ETag, version_id: complete_res.VersionId };
        }

        mocha.it('completes STANDARD multipart upload and allows getObject', async function() {
            const key = 's3-mpu/standard';
            const part1 = crypto.randomBytes(5 * 1024 * 1024);
            const part2 = crypto.randomBytes(64);
            const buf = Buffer.concat([part1, part2]);

            const { etag } = await multipart_upload({
                key,
                parts: [part1, part2],
                storage_class: s3_utils.STORAGE_CLASS_STANDARD,
            });
            assert.ok(etag);

            const md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });
            assert.strictEqual(md.size, buf.length);
            assert.ok(!md.storage_class || md.storage_class === s3_utils.STORAGE_CLASS_STANDARD);
            assert.ok(!md.target_data_info?.upload_id);

            const get_res = await s3.getObject({ Bucket: BUCKET, Key: key });
            const body = Buffer.from(await get_res.Body.transformToByteArray());
            assert.strictEqual(Buffer.compare(body, buf), 0);
        });

        s3_utils.GLACIER_STORAGE_CLASSES.forEach(storage_class => {

            mocha.it(`completes ${storage_class} multipart upload (MD in NB, data under archive_key)`, async function() {
                const key = `s3-mpu/complete/${storage_class}`;
                const part1 = crypto.randomBytes(5 * 1024 * 1024);
                const part2 = crypto.randomBytes(128);
                const buf = Buffer.concat([part1, part2]);

                const { etag } = await multipart_upload({
                    key,
                    parts: [part1, part2],
                    storage_class,
                });

                await assert_archived_via_s3({ key, buf, storage_class });
                const head = await s3.headObject({ Bucket: BUCKET, Key: key });
                assert.strictEqual(
                    s3_utils.parse_etag(head.ETag),
                    s3_utils.parse_etag(etag)
                );
            });
            mocha.it(`rejects ${storage_class} complete with wrong part etag`, async function() {
                const key = `s3-mpu/invalid-part/${storage_class}`;
                const part_buf = crypto.randomBytes(64);
                const create_res = await s3.createMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    ContentType: 'application/octet-stream',
                    StorageClass: storage_class,
                });
                const upload_id = create_res.UploadId;
                const part_res = await s3.uploadPart({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                    PartNumber: 1,
                    Body: part_buf,
                    ContentLength: part_buf.length,
                });
                assert.ok(part_res.ETag);

                await assert.rejects(
                    s3.completeMultipartUpload({
                        Bucket: BUCKET,
                        Key: key,
                        UploadId: upload_id,
                        MultipartUpload: {
                            Parts: [{ ETag: '"00000000000000000000000000000000"', PartNumber: 1 }],
                        },
                    }),
                    err => err_code(err) === 'InvalidPart'
                );

                await s3.abortMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                });
            });

            mocha.it(`rejects ${storage_class} complete with non-contiguous parts`, async function() {
                const key = `s3-mpu/gap-parts/${storage_class}`;
                const part1 = crypto.randomBytes(5 * 1024 * 1024);
                const part2 = crypto.randomBytes(64);
                const create_res = await s3.createMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    ContentType: 'application/octet-stream',
                    StorageClass: storage_class,
                });
                const upload_id = create_res.UploadId;
                await s3.uploadPart({
                    Bucket: BUCKET, Key: key, UploadId: upload_id, PartNumber: 1,
                    Body: part1, ContentLength: part1.length,
                });
                const part2_res = await s3.uploadPart({
                    Bucket: BUCKET, Key: key, UploadId: upload_id, PartNumber: 2,
                    Body: part2, ContentLength: part2.length,
                });

                // Skip part 1 in Complete — NB requires contiguous 1..N.
                await assert.rejects(
                    s3.completeMultipartUpload({
                        Bucket: BUCKET,
                        Key: key,
                        UploadId: upload_id,
                        MultipartUpload: {
                            Parts: [{ ETag: part2_res.ETag, PartNumber: 2 }],
                        },
                    }),
                    err => err_code(err) === 'InvalidPart'
                );

                await s3.abortMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                });
            });

            mocha.it(`completes ${storage_class} MPU omitting an unused uploaded part`, async function() {
                const key = `s3-mpu/unused-part/${storage_class}`;
                const part1 = crypto.randomBytes(5 * 1024 * 1024);
                const part2 = crypto.randomBytes(128);
                const unused = crypto.randomBytes(64);
                const buf = Buffer.concat([part1, part2]);

                const create_res = await s3.createMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    ContentType: 'application/octet-stream',
                    StorageClass: storage_class,
                });
                const upload_id = create_res.UploadId;

                const part1_res = await s3.uploadPart({
                    Bucket: BUCKET, Key: key, UploadId: upload_id, PartNumber: 1,
                    Body: part1, ContentLength: part1.length,
                });
                const part2_res = await s3.uploadPart({
                    Bucket: BUCKET, Key: key, UploadId: upload_id, PartNumber: 2,
                    Body: part2, ContentLength: part2.length,
                });
                // Uploaded but omitted from Complete — should be soft-deleted on MD finalize.
                await s3.uploadPart({
                    Bucket: BUCKET, Key: key, UploadId: upload_id, PartNumber: 3,
                    Body: unused, ContentLength: unused.length,
                });

                await s3.completeMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                    MultipartUpload: {
                        Parts: [
                            { ETag: part1_res.ETag, PartNumber: 1 },
                            { ETag: part2_res.ETag, PartNumber: 2 },
                        ],
                    },
                });

                await assert_archived_via_s3({ key, buf, storage_class });

                const remaining = await MDStore.instance().find_all_multiparts_of_object(parse_obj_id(upload_id));
                assert.strictEqual(remaining.length, 2, 'unused multipart should be soft-deleted');
                assert.ok(remaining.every(mp => !mp.uncommitted), 'used multiparts should clear uncommitted');
                assert.deepStrictEqual(remaining.map(mp => mp.num).sort(), [1, 2]);
            });

            mocha.it(`create/uploadPart/listParts for ${storage_class} sets target_data_info`, async function() {
                const key = `s3-mpu/in-progress/${storage_class}`;
                const create_res = await s3.createMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    ContentType: 'application/octet-stream',
                    StorageClass: storage_class,
                });
                const upload_id = create_res.UploadId;

                const md = await rpc_client.object.read_object_md({
                    bucket: BUCKET,
                    key,
                    obj_id: upload_id,
                });
                assert.strictEqual(md.storage_class, storage_class);
                assert.ok(md.target_data_info?.upload_id);
                assert.notStrictEqual(md.target_data_info.upload_id, upload_id);

                const archive_key = get_archive_key(bucket_id, upload_id);
                const listed = await s3.listParts({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                });
                assert.strictEqual((listed.Parts || []).length, 0);

                // Archive MPU exists under archive_key on the archive target.
                const archive_parts = await s3.listParts({
                    Bucket: ARCHIVE_TARGET_BUCKET,
                    Key: archive_key,
                    UploadId: md.target_data_info.upload_id,
                });
                assert.strictEqual((archive_parts.Parts || []).length, 0);

                const part_buf = crypto.randomBytes(64);
                const part_res = await s3.uploadPart({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                    PartNumber: 1,
                    Body: part_buf,
                    ContentLength: part_buf.length,
                });

                // ListParts is served from NB MD for archive uploads as well.
                const listed_after = await s3.listParts({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                });
                const listed_parts = listed_after.Parts || [];
                assert.strictEqual(listed_parts.length, 1);
                assert.strictEqual(listed_parts[0].PartNumber, 1);
                assert.strictEqual(listed_parts[0].Size, part_buf.length);
                assert.strictEqual(
                    s3_utils.parse_etag(listed_parts[0].ETag),
                    s3_utils.parse_etag(part_res.ETag)
                );

                await s3.abortMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                });
            });

            mocha.it(`aborts ${storage_class} multipart upload on both NB MD and archive`, async function() {
                const key = `s3-mpu/abort/${storage_class}`;
                const create_res = await s3.createMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    ContentType: 'application/octet-stream',
                    StorageClass: storage_class,
                });
                const upload_id = create_res.UploadId;
                const md = await rpc_client.object.read_object_md({
                    bucket: BUCKET,
                    key,
                    obj_id: upload_id,
                });
                const archive_key = get_archive_key(bucket_id, upload_id);
                const target_upload_id = md.target_data_info.upload_id;

                await s3.uploadPart({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                    PartNumber: 1,
                    Body: crypto.randomBytes(64),
                });

                await s3.abortMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                });

                await assert.rejects(
                    s3.listParts({ Bucket: BUCKET, Key: key, UploadId: upload_id }),
                    err => err_code(err) === 'NoSuchUpload'
                );
                await assert.rejects(
                    s3.listParts({
                        Bucket: ARCHIVE_TARGET_BUCKET,
                        Key: archive_key,
                        UploadId: target_upload_id,
                    }),
                    err => err_code(err) === 'NoSuchUpload'
                );

                // Abort soft-deletes object MD only; multiparts remain until ObjectsReclaimer.
                const multiparts_before = await MDStore.instance().find_all_multiparts_of_object(parse_obj_id(upload_id));
                assert.strictEqual(multiparts_before.length, 1, 'multipart MD should remain until reclaim');
                await assert_object_unreclaimed(upload_id);
                await run_objects_reclaimer(upload_id);
                const multiparts_after = await MDStore.instance().find_all_multiparts_of_object(parse_obj_id(upload_id));
                assert.strictEqual(multiparts_after.length, 0, 'ObjectsReclaimer should soft-delete archive MPU multiparts');
            });

            mocha.it(`uploadPartCopy STANDARD → ${storage_class} MPU then completes`, async function() {
                const source_key = `s3-mpu/part-copy-src/${storage_class}`;
                const key = `s3-mpu/part-copy-dst/${storage_class}`;
                const buf = Buffer.from(`part-copy-payload-${storage_class}`);

                await s3.putObject({
                    Bucket: BUCKET,
                    Key: source_key,
                    Body: buf,
                    ContentType: 'application/octet-stream',
                });

                const create_res = await s3.createMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    ContentType: 'application/octet-stream',
                    StorageClass: storage_class,
                });
                const upload_id = create_res.UploadId;

                const part_res = await s3.uploadPartCopy({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                    PartNumber: 1,
                    CopySource: `/${BUCKET}/${source_key}`,
                });
                assert.ok(part_res.CopyPartResult?.ETag);

                await s3.completeMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                    MultipartUpload: {
                        Parts: [{ ETag: part_res.CopyPartResult.ETag, PartNumber: 1 }],
                    },
                });

                await assert_archived_via_s3({ key, buf, storage_class });
            });

        });

        mocha.it('listMultipartUploads includes in-progress archive MPUs', async function() {
            const prefix = 's3-mpu/list-uploads/';
            const uploads = [];

            for (const storage_class of s3_utils.GLACIER_STORAGE_CLASSES) {
                const key = `${prefix}${storage_class}`;
                const create_res = await s3.createMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    ContentType: 'application/octet-stream',
                    StorageClass: storage_class,
                });
                uploads.push({ key, upload_id: create_res.UploadId, storage_class });
            }

            const listed = await s3.listMultipartUploads({
                Bucket: BUCKET,
                Prefix: prefix,
            });
            const by_key = new Map((listed.Uploads || []).map(u => [u.Key, u]));

            for (const { key, upload_id, storage_class } of uploads) {
                const entry = by_key.get(key);
                assert.ok(entry, `expected listMultipartUploads to include ${key}`);
                assert.strictEqual(entry.UploadId, upload_id);
                assert.strictEqual(entry.StorageClass, storage_class);
            }

            for (const { key, upload_id } of uploads) {
                await s3.abortMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    UploadId: upload_id,
                });
            }

            const listed_after = await s3.listMultipartUploads({
                Bucket: BUCKET,
                Prefix: prefix,
            });
            assert.strictEqual((listed_after.Uploads || []).length, 0);
        });

        mocha.it('rejects GLACIER_IR multipart with NotImplemented', async function() {
            await assert.rejects(
                s3.createMultipartUpload({
                    Bucket: BUCKET,
                    Key: 's3-mpu/glacier-ir',
                    ContentType: 'application/octet-stream',
                    StorageClass: s3_utils.STORAGE_CLASS_GLACIER_IR,
                }),
                err => err_code(err) === 'NotImplemented'
            );
        });

        mocha.describe('MPU error handling', function() {
            const storage_class = s3_utils.STORAGE_CLASS_DEEP_ARCHIVE;
            const nonexistent_upload_id = '000000000000000000000000';

            mocha.it('returns NoSuchUpload for nonexistent upload id', async function() {
                const key = 's3-mpu/err/no-such-upload-id';
                await assert.rejects(
                    s3.uploadPart({
                        Bucket: BUCKET, Key: key, UploadId: nonexistent_upload_id,
                        PartNumber: 1, Body: crypto.randomBytes(64),
                    }),
                    err => err_code(err) === 'NoSuchUpload'
                );
                await assert.rejects(
                    s3.listParts({ Bucket: BUCKET, Key: key, UploadId: nonexistent_upload_id }),
                    err => err_code(err) === 'NoSuchUpload'
                );
                await assert.rejects(
                    s3.completeMultipartUpload({
                        Bucket: BUCKET, Key: key, UploadId: nonexistent_upload_id,
                        MultipartUpload: {
                            Parts: [{ ETag: '"00000000000000000000000000000000"', PartNumber: 1 }],
                        },
                    }),
                    err => err_code(err) === 'NoSuchUpload'
                );
                await assert.rejects(
                    s3.abortMultipartUpload({
                        Bucket: BUCKET, Key: key, UploadId: nonexistent_upload_id,
                    }),
                    err => err_code(err) === 'NoSuchUpload'
                );
            });

            mocha.it('returns NoSuchUpload when key does not match the upload', async function() {
                const key = 's3-mpu/err/key-mismatch';
                const other_key = 's3-mpu/err/key-mismatch-other';
                const create_res = await s3.createMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    ContentType: 'application/octet-stream',
                    StorageClass: storage_class,
                });
                const upload_id = create_res.UploadId;

                await assert.rejects(
                    s3.uploadPart({
                        Bucket: BUCKET, Key: other_key, UploadId: upload_id,
                        PartNumber: 1, Body: crypto.randomBytes(64),
                    }),
                    err => err_code(err) === 'NoSuchUpload'
                );
                await assert.rejects(
                    s3.listParts({ Bucket: BUCKET, Key: other_key, UploadId: upload_id }),
                    err => err_code(err) === 'NoSuchUpload'
                );
                await assert.rejects(
                    s3.completeMultipartUpload({
                        Bucket: BUCKET, Key: other_key, UploadId: upload_id,
                        MultipartUpload: {
                            Parts: [{ ETag: '"00000000000000000000000000000000"', PartNumber: 1 }],
                        },
                    }),
                    err => err_code(err) === 'NoSuchUpload'
                );

                await s3.abortMultipartUpload({
                    Bucket: BUCKET, Key: key, UploadId: upload_id,
                });
            });

            mocha.it('returns NoSuchUpload for MPU ops after abort', async function() {
                const key = 's3-mpu/err/ops-after-abort';
                const create_res = await s3.createMultipartUpload({
                    Bucket: BUCKET,
                    Key: key,
                    ContentType: 'application/octet-stream',
                    StorageClass: storage_class,
                });
                const upload_id = create_res.UploadId;
                await s3.uploadPart({
                    Bucket: BUCKET, Key: key, UploadId: upload_id,
                    PartNumber: 1, Body: crypto.randomBytes(64),
                });
                await s3.abortMultipartUpload({
                    Bucket: BUCKET, Key: key, UploadId: upload_id,
                });

                await assert.rejects(
                    s3.uploadPart({
                        Bucket: BUCKET, Key: key, UploadId: upload_id,
                        PartNumber: 2, Body: crypto.randomBytes(64),
                    }),
                    err => err_code(err) === 'NoSuchUpload'
                );
                await assert.rejects(
                    s3.listParts({ Bucket: BUCKET, Key: key, UploadId: upload_id }),
                    err => err_code(err) === 'NoSuchUpload'
                );
                await assert.rejects(
                    s3.completeMultipartUpload({
                        Bucket: BUCKET, Key: key, UploadId: upload_id,
                        MultipartUpload: {
                            Parts: [{ ETag: '"00000000000000000000000000000000"', PartNumber: 1 }],
                        },
                    }),
                    err => err_code(err) === 'NoSuchUpload'
                );
                await assert.rejects(
                    s3.abortMultipartUpload({
                        Bucket: BUCKET, Key: key, UploadId: upload_id,
                    }),
                    err => err_code(err) === 'NoSuchUpload'
                );
            });
        });

        mocha.describe('MPU + Versioning', function() {
            const storage_class = s3_utils.STORAGE_CLASS_DEEP_ARCHIVE;

            mocha.it('ENABLED: archive MPU creates distinct versions with separate archive keys', async function() {
                await s3.putBucketVersioning({
                    Bucket: BUCKET,
                    VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' },
                });

                const key = 's3-mpu/versioning/enabled';
                const parts1 = [crypto.randomBytes(5 * 1024 * 1024), crypto.randomBytes(32)];
                const parts2 = [crypto.randomBytes(5 * 1024 * 1024), crypto.randomBytes(64)];
                const buf1 = Buffer.concat(parts1);
                const buf2 = Buffer.concat(parts2);

                const r1 = await multipart_upload({ key, parts: parts1, storage_class });
                assert.ok(r1.version_id);
                assert.notStrictEqual(r1.version_id, 'null');

                const r2 = await multipart_upload({ key, parts: parts2, storage_class });
                assert.ok(r2.version_id);
                assert.notStrictEqual(r2.version_id, 'null');
                assert.notStrictEqual(r2.version_id, r1.version_id);

                const listed = await s3.listObjectVersions({ Bucket: BUCKET, Prefix: key });
                const versions = (listed.Versions || []).filter(v => v.Key === key);
                assert.strictEqual(versions.length, 2);
                assert.ok(versions.every(v => v.VersionId === r1.version_id || v.VersionId === r2.version_id));

                const md1 = await rpc_client.object.read_object_md({ bucket: BUCKET, key, version_id: r1.version_id });
                const md2 = await rpc_client.object.read_object_md({ bucket: BUCKET, key, version_id: r2.version_id });
                assert.notStrictEqual(md1.obj_id, md2.obj_id);

                await assert_archived_via_s3({ key, buf: buf1, storage_class, version_id: r1.version_id });
                await assert_archived_via_s3({ key, buf: buf2, storage_class, version_id: r2.version_id });
            });

            mocha.it('SUSPENDED: archive MPU replaces null version; latest points at new archive object', async function() {
                await s3.putBucketVersioning({
                    Bucket: BUCKET,
                    VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Suspended' },
                });

                const key = 's3-mpu/versioning/suspended';
                const parts1 = [crypto.randomBytes(5 * 1024 * 1024), crypto.randomBytes(16)];
                const parts2 = [crypto.randomBytes(5 * 1024 * 1024), crypto.randomBytes(48)];
                const buf2 = Buffer.concat(parts2);

                await multipart_upload({ key, parts: parts1, storage_class });
                await multipart_upload({ key, parts: parts2, storage_class });

                const latest_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });
                assert.strictEqual(latest_md.size, buf2.length);
                assert.strictEqual(latest_md.storage_class, storage_class);

                const listed = await s3.listObjectVersions({ Bucket: BUCKET, Prefix: key });
                const latest_versions = (listed.Versions || []).filter(v => v.Key === key && v.IsLatest);
                assert.strictEqual(latest_versions.length, 1);
                assert.strictEqual(latest_versions[0].Size, buf2.length);

                await assert_archived_via_s3({ key, buf: buf2, storage_class });
            });
        });

    }); // MultipartUpload

    mocha.describe('Lifecycle AbortIncompleteMultipartUpload', function() {
        // remove_pending_multiparts uses postgres-specific SQL
        if (config.DB_TYPE !== 'postgres') return;

        this.timeout(120000); // eslint-disable-line no-invalid-this

        let original_schedule_min;
        let original_interval;

        mocha.before(function() {
            original_schedule_min = config.LIFECYCLE_SCHEDULE_MIN;
            original_interval = config.LIFECYCLE_INTERVAL;
            config.LIFECYCLE_SCHEDULE_MIN = 0;
            config.LIFECYCLE_INTERVAL = 0;
        });

        mocha.after(function() {
            config.LIFECYCLE_SCHEDULE_MIN = original_schedule_min;
            config.LIFECYCLE_INTERVAL = original_interval;
        });

        s3_utils.GLACIER_STORAGE_CLASSES.forEach(storage_class => {

            mocha.it(`lifecycle abort of incomplete ${storage_class} MPU; reclaimer aborts archive`, async function() {
                const prefix = `s3-mpu/lifecycle-abort/${storage_class}-${Date.now()}`;
                const key = `${prefix}/obj`;
                const parts_age = 30;
                const { obj_id, archive_key, upload_id } = await start_incomplete_archive_mpu({
                    key,
                    storage_class,
                });
                await assert_archive_mpu_present(archive_key, upload_id);

                // Age the upload past DaysAfterInitiation
                await MDStore.instance().update_object_by_id(parse_obj_id(obj_id), {
                    upload_started: MDStore.instance().make_md_id_from_time(
                        Date.now() - parts_age * 24 * 60 * 60 * 1000
                    ),
                });

                await s3.putBucketLifecycleConfiguration({
                    Bucket: BUCKET,
                    LifecycleConfiguration: {
                        Rules: [{
                            ID: 'abort-incomplete-mpu',
                            Status: 'Enabled',
                            Filter: { Prefix: prefix },
                            AbortIncompleteMultipartUpload: {
                                DaysAfterInitiation: parts_age - 10,
                            },
                        }],
                    },
                });

                await lifecycle.background_worker();

                // Lifecycle only soft-deletes NB MD; archive MPU remains until ObjectsReclaimer.
                await assert.rejects(
                    s3.listParts({ Bucket: BUCKET, Key: key, UploadId: obj_id }),
                    err => err_code(err) === 'NoSuchUpload'
                );
                await assert_object_unreclaimed(obj_id);
                await assert_archive_mpu_present(archive_key, upload_id);

                await run_objects_reclaimer(obj_id);
                await assert_object_reclaimed(obj_id);
                await assert_archive_mpu_absent(archive_key, upload_id);
            });

        });

    });

    // TODO: add GetObject tests (STANDARD read, unrestored / ongoing / expired restore →
    // InvalidObjectState, restored archive read) once RestoreObject is implemented.
});
