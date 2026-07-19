/* Copyright (C) 2026 NooBaa */
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
 * Asserts archived object MD and that payload lives under get_archive_key on the archive target.
 * @param {{ key: string, buf: Buffer, storage_class: string }} args
 * @returns {Promise<void>}
 */
async function assert_archived_via_s3({ key, buf, storage_class }) {
    const md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });
    assert.strictEqual(md.storage_class, storage_class);
    assert.strictEqual(md.size, buf.length);

    const archive_key = get_archive_key(bucket_id, md.obj_id);
    const archived = await s3.getObject({ Bucket: ARCHIVE_TARGET_BUCKET, Key: archive_key });
    const archived_body = Buffer.from(await archived.Body.transformToByteArray());
    assert.strictEqual(Buffer.compare(archived_body, buf), 0);

    await assert.rejects(
        s3.headObject({ Bucket: ARCHIVE_TARGET_BUCKET, Key: key }),
        err => err_code(err) === 'NotFound' || err_code(err) === 'NoSuchKey'
    );

    await assert.rejects(
        s3.getObject({ Bucket: BUCKET, Key: key }),
        err => err_code(err) === 'InvalidObjectState'
    );
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

    // TODO: add GetObject tests (STANDARD read, unrestored / ongoing / expired restore →
    // InvalidObjectState, restored archive read) once RestoreObject is implemented.
});
