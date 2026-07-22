/* Copyright (C) 2026 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });

const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

const config = require('../../../../config');
const NamespaceNB = require('../../../sdk/namespace_nb');
const NamespaceS3 = require('../../../sdk/namespace_s3');
const NamespaceMultiStorageClass = require('../../../sdk/namespace_multi_storage_class');
const ObjectIO = require('../../../sdk/object_io');
const s3_utils = require('../../../endpoint/s3/s3_utils');
const buffer_utils = require('../../../util/buffer_utils');
const http_utils = require('../../../util/http_utils');
const { get_archive_key } = require('../../../util/deep_archive_utils');
const endpoint_stats_collector = require('../../../sdk/endpoint_stats_collector');
const S3Error = require('../../../endpoint/s3/s3_errors').S3Error;
const test_utils = require('../../system_tests/test_utils');

const { rpc_client, EMAIL } = coretest;

const BUCKET = 'test-msc';
const ARCHIVE_TARGET_BUCKET = 'test-msc-archive-target';
const ARCHIVE_CONNECTION = 'msc_archive_connection';
const ARCHIVE_NSR = 'msc_archive_nsr';

// AWS S3 client is used only for archive-target bucket create/delete
// (NamespaceS3.create_uls / delete_uls are unimplemented). Object I/O goes through namespaces.
let s3;
let bucket_id;
let s3_creds;

/**
 * Minimal object_sdk for NamespaceNB / NamespaceS3 upload and read paths.
 * @returns {object}
 */
function make_object_sdk() {
    const object_io = new ObjectIO();
    return {
        rpc_client,
        object_io,
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        },
    };
}

/**
 * Builds a NamespaceS3 pointed at the archive target (or overrides for failure tests).
 * @param {{ namespace_resource_id?: string, bucket?: string }} [args]
 * @returns {NamespaceS3}
 */
function make_archive_namespace_s3({ namespace_resource_id, bucket } = {}) {
    return new NamespaceS3({
        namespace_resource_id: namespace_resource_id || ARCHIVE_NSR,
        bucket: bucket || ARCHIVE_TARGET_BUCKET,
        stats: endpoint_stats_collector.instance(),
        s3_params: {
            endpoint: coretest.get_http_address(),
            credentials: {
                accessKeyId: s3_creds.accessKeyId,
                secretAccessKey: s3_creds.secretAccessKey,
            },
            forcePathStyle: true,
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpAgent: http_utils.get_unsecured_agent(coretest.get_http_address()),
            }),
        },
    });
}

/**
 * Builds a NamespaceMultiStorageClass with NamespaceNB (STANDARD) and NamespaceS3 (archive).
 * @param {{ metadata_ns?: nb.Namespace, archive_ns?: nb.Namespace, archive_ns_args?: { namespace_resource_id?: string, bucket?: string} }} [args]
 * @returns {{ msc: NamespaceMultiStorageClass, md_ns: nb.Namespace, arch_ns: nb.Namespace }}
 */
function get_new_multi_storage_class_namespace({ metadata_ns, archive_ns, archive_ns_args } = {}) {
    const md_ns = metadata_ns || new NamespaceNB();
    const arch_ns = archive_ns || make_archive_namespace_s3(archive_ns_args);
    const msc = new NamespaceMultiStorageClass({
        namespace_by_storage_class: {
            [s3_utils.STORAGE_CLASS_STANDARD]: md_ns,
            [s3_utils.STORAGE_CLASS_DEEP_ARCHIVE]: arch_ns,
            [s3_utils.STORAGE_CLASS_GLACIER]: arch_ns,
        },
    });
    return { msc, md_ns, arch_ns };
}

/**
 * Uploads a buffer via NamespaceMultiStorageClass.upload_object.
 * @param {NamespaceMultiStorageClass} msc
 * @param {object} object_sdk
 * @param {{ key: string, buf: Buffer, storage_class?: string }} params
 * @returns {Promise<object>}
 */
async function upload_buf(msc, object_sdk, { key, buf, storage_class }) {
    const source_stream = buffer_utils.buffer_to_read_stream(buf);
    return msc.upload_object({
        bucket: BUCKET,
        key,
        size: buf.length,
        content_type: 'application/octet-stream',
        md5_b64: crypto.createHash('md5').update(buf).digest('base64'),
        storage_class,
        source_stream,
    }, object_sdk);
}

/**
 * Simulates ObjectSDK CopyObject fallback when is_server_side_copy is false:
 * read source stream, then upload with source_stream (copy_source cleared).
 * @param {NamespaceMultiStorageClass} msc
 * @param {object} object_sdk
 * @param {{ source_key: string, source_md: object, dest_key: string, dest_storage_class?: string, buf: Buffer }} params
 * @returns {Promise<object>}
 */
async function copy_via_stream_fallback(msc, object_sdk, {
    source_key,
    source_md,
    dest_key,
    dest_storage_class,
    buf,
}) {
    const source_stream = await msc.read_object_stream({
        bucket: BUCKET,
        key: source_key,
        object_md: source_md,
    }, object_sdk);

    return msc.upload_object({
        bucket: BUCKET,
        key: dest_key,
        size: buf.length,
        content_type: 'application/octet-stream',
        md5_b64: crypto.createHash('md5').update(buf).digest('base64'),
        storage_class: dest_storage_class,
        source_stream,
        // ObjectSDK clears copy_source before upload in the fallback path
        copy_source: null,
    }, object_sdk);
}

/**
 * Asserts object md (storage_class, size), that archive data is stored under get_archive_key
 * (via the archive namespace), not the user key, and that MSC read_object_stream rejects
 * with InvalidObjectState.
 * @param {{ msc: NamespaceMultiStorageClass, arch_ns: nb.Namespace, object_sdk: object, key: string, buf: Buffer, storage_class: string, etag: string }} args
 * @returns {Promise<void>}
 */
async function assert_archived_payload({ msc, arch_ns, object_sdk, key, buf, storage_class, etag }) {
    const md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });
    assert.strictEqual(md.storage_class, storage_class);
    assert.strictEqual(md.size, buf.length);
    assert.strictEqual(md.etag, etag);

    const archive_key = get_archive_key(bucket_id, md.obj_id);
    // mock for archive target bucket listing, we use the same noobaa endpoint as the archive 
    const listed = await arch_ns.list_objects({
        bucket: ARCHIVE_TARGET_BUCKET,
        prefix: 'noobaa_storage/',
    }, object_sdk);
    const keys = (listed.objects || []).map(o => o.key);
    assert.ok(
        keys.includes(archive_key),
        `expected archive key ${archive_key} in target, got: ${JSON.stringify(keys)}`
    );

    const archived_stream = await arch_ns.read_object_stream({
        bucket: ARCHIVE_TARGET_BUCKET,
        key: archive_key,
    }, object_sdk);
    const archived_buf = await buffer_utils.read_stream_join(archived_stream);
    assert.strictEqual(Buffer.compare(archived_buf, buf), 0);

    // User-facing key must not be used for archive data
    await assert.rejects(
        arch_ns.read_object_md({ bucket: ARCHIVE_TARGET_BUCKET, key }, object_sdk),
        err => err.rpc_code === 'NO_SUCH_OBJECT'
    );

    // GetObject / read_object_stream on archived objects is not allowed until restore
    await assert.rejects(
        msc.read_object_stream({ bucket: BUCKET, key, object_md: md }, object_sdk),
        err => err instanceof S3Error && err.code === 'InvalidObjectState'
    );
}

mocha.describe('NamespaceMultiStorageClass', function() {
    const object_sdk = make_object_sdk();

    mocha.before(async function() {
        const account_info = await rpc_client.account.read_account({ email: EMAIL });
        s3_creds = {
            accessKeyId: account_info.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
        };
        s3 = new S3({
            endpoint: coretest.get_http_address(),
            credentials: s3_creds,
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
            identity: s3_creds.accessKeyId,
            secret: s3_creds.secretAccessKey,
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

    mocha.describe('upload_object', function() {

    mocha.it('uploads STANDARD objects via the metadata namespace and allows reading', async function() {
        const { msc } = get_new_multi_storage_class_namespace();
        const key = 'standard/object';
        const buf = crypto.randomBytes(64);

        const reply = await upload_buf(msc, object_sdk, { key, buf, storage_class: s3_utils.STORAGE_CLASS_STANDARD });
        assert.ok(reply.etag);

        const md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });
        assert.strictEqual(md.size, buf.length);
        assert.ok(!md.storage_class || md.storage_class === s3_utils.STORAGE_CLASS_STANDARD);

        const read_stream = await msc.read_object_stream({ bucket: BUCKET, key, object_md: md }, object_sdk);
        const read_buf = await buffer_utils.read_stream_join(read_stream);
        assert.strictEqual(Buffer.compare(read_buf, buf), 0);
    });

    mocha.it('defaults to STANDARD when storage_class is unset', async function() {
        const { msc } = get_new_multi_storage_class_namespace();
        const key = 'standard/default-sc';
        const buf = crypto.randomBytes(32);

        await upload_buf(msc, object_sdk, { key, buf });

        const md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });
        assert.strictEqual(md.size, buf.length);
        assert.ok(!md.storage_class || md.storage_class === s3_utils.STORAGE_CLASS_STANDARD);
    });

    mocha.it('upload_object to sc=DEEP_ARCHIVE storage class', async function() {
        const { msc, arch_ns } = get_new_multi_storage_class_namespace();
        const key = 'archive/deep-object';
        const buf = Buffer.from('deep-archive-payload');

        const reply = await upload_buf(msc, object_sdk, { key, buf, storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE });

        await assert_archived_payload({
            msc, arch_ns, object_sdk, key, buf,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            etag: reply.etag,
        });
    });

    mocha.it('upload_object to sc=GLACIER storage class', async function() {
        const { msc, arch_ns } = get_new_multi_storage_class_namespace();
        const key = 'archive/glacier-object';
        const buf = Buffer.from('glacier-payload');

        const reply = await upload_buf(msc, object_sdk, { key, buf, storage_class: s3_utils.STORAGE_CLASS_GLACIER });

        await assert_archived_payload({
            msc, arch_ns, object_sdk, key, buf,
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
            etag: reply.etag,
        });
    });

    mocha.it('upload_object to STORAGE_CLASS_GLACIER_IR which is unsupported - should fail with NotImplemented', async function() {
        const { msc } = get_new_multi_storage_class_namespace();
        const buf = Buffer.from('x');

        await assert.rejects(
            upload_buf(msc, object_sdk, { key: 'unmapped', buf, storage_class: s3_utils.STORAGE_CLASS_GLACIER_IR }),
            err => err instanceof S3Error && err.code === 'NotImplemented'
        );
    });

    // we intentionally not calling upload_buf here to avoid the actual upload failure
    // so we can check that the source_stream is destroyed and the upload is aborted
    mocha.it('aborts upload_object when upload fails, sc=DEEP_ARCHIVE', async function() {
        const { msc } = get_new_multi_storage_class_namespace({
            archive_ns_args: {
                namespace_resource_id: 'missing-archive-nsr',
                bucket: 'nonexistent-archive-target-bucket',
            },
        });
        const key = 'archive/fail-data';
        const buf = Buffer.from('will-fail');
        const source_stream = buffer_utils.buffer_to_read_stream(buf);

        await assert.rejects(msc.upload_object({
            bucket: BUCKET,
            key,
            size: buf.length,
            content_type: 'application/octet-stream',
            md5_b64: crypto.createHash('md5').update(buf).digest('base64'),
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            source_stream,
        }, object_sdk));

        assert.strictEqual(source_stream.destroyed, true);

        await assert.rejects(
            rpc_client.object.read_object_md({ bucket: BUCKET, key }),
            err => err.rpc_code === 'NO_SUCH_OBJECT' || err.rpc_code === 'NO_SUCH_UPLOAD'
        );
    });

    }); // upload_object

    mocha.describe('CopyObject (stream fallback)', function() {

    mocha.it('disables server-side copy so ObjectSDK uses the stream fallback', function() {
        const { msc } = get_new_multi_storage_class_namespace();
        assert.strictEqual(msc.is_server_side_copy({}, {}, {}), false);
    });

    mocha.it('copies STANDARD → STANDARD via metadata namespace', async function() {
        const { msc } = get_new_multi_storage_class_namespace();
        const source_key = 'copy/std-to-std-src';
        const dest_key = 'copy/std-to-std-dst';
        const buf = crypto.randomBytes(48);

        await upload_buf(msc, object_sdk, { key: source_key, buf, storage_class: s3_utils.STORAGE_CLASS_STANDARD });
        const source_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key: source_key });

        const reply = await copy_via_stream_fallback(msc, object_sdk, {
            source_key,
            source_md,
            dest_key,
            dest_storage_class: s3_utils.STORAGE_CLASS_STANDARD,
            buf,
        });
        assert.ok(reply.etag);

        const dest_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key: dest_key });
        assert.strictEqual(dest_md.size, buf.length);
        assert.ok(!dest_md.storage_class || dest_md.storage_class === s3_utils.STORAGE_CLASS_STANDARD);

        const read_stream = await msc.read_object_stream({ bucket: BUCKET, key: dest_key, object_md: dest_md }, object_sdk);
        const read_buf = await buffer_utils.read_stream_join(read_stream);
        assert.strictEqual(Buffer.compare(read_buf, buf), 0);
    });

    mocha.it('copies STANDARD → DEEP_ARCHIVE (MD in NB, data under archive_key)', async function() {
        const { msc, arch_ns } = get_new_multi_storage_class_namespace();
        const source_key = 'copy/std-to-archive-src';
        const dest_key = 'copy/std-to-archive-dst';
        const buf = Buffer.from('copy-to-deep-archive');

        await upload_buf(msc, object_sdk, { key: source_key, buf, storage_class: s3_utils.STORAGE_CLASS_STANDARD });
        const source_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key: source_key });

        const reply = await copy_via_stream_fallback(msc, object_sdk, {
            source_key,
            source_md,
            dest_key,
            dest_storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            buf,
        });

        await assert_archived_payload({
            msc, arch_ns, object_sdk,
            key: dest_key,
            buf,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            etag: reply.etag,
        });
    });

    mocha.it('copies restored archive → STANDARD via metadata namespace', async function() {
        const { msc } = get_new_multi_storage_class_namespace();
        const source_key = 'copy/restored-to-std-src';
        const dest_key = 'copy/restored-to-std-dst';
        const buf = Buffer.from('restored-copy-src');

        // Data lives in NB (STANDARD upload); md is marked as restored archive for the read gate.
        await upload_buf(msc, object_sdk, { key: source_key, buf, storage_class: s3_utils.STORAGE_CLASS_STANDARD });
        const source_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key: source_key });
        source_md.storage_class = s3_utils.STORAGE_CLASS_DEEP_ARCHIVE;
        source_md.restore_status = {
            ongoing: false,
            expiry_time: new Date('2099-01-01T00:00:00Z'),
        };

        const reply = await copy_via_stream_fallback(msc, object_sdk, {
            source_key,
            source_md,
            dest_key,
            dest_storage_class: s3_utils.STORAGE_CLASS_STANDARD,
            buf,
        });
        assert.ok(reply.etag);

        const dest_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key: dest_key });
        const read_stream = await msc.read_object_stream({ bucket: BUCKET, key: dest_key, object_md: dest_md }, object_sdk);
        const read_buf = await buffer_utils.read_stream_join(read_stream);
        assert.strictEqual(Buffer.compare(read_buf, buf), 0);
    });

    mocha.it('copies restored archive → DEEP_ARCHIVE', async function() {
        const { msc, arch_ns } = get_new_multi_storage_class_namespace();
        const source_key = 'copy/restored-to-archive-src';
        const dest_key = 'copy/restored-to-archive-dst';
        const buf = Buffer.from('restored-rearchive');

        await upload_buf(msc, object_sdk, { key: source_key, buf, storage_class: s3_utils.STORAGE_CLASS_STANDARD });
        const source_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key: source_key });
        source_md.storage_class = s3_utils.STORAGE_CLASS_GLACIER;
        source_md.restore_status = {
            ongoing: false,
            expiry_time: new Date('2099-06-01T00:00:00Z'),
        };

        const reply = await copy_via_stream_fallback(msc, object_sdk, {
            source_key,
            source_md,
            dest_key,
            dest_storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            buf,
        });

        await assert_archived_payload({
            msc, arch_ns, object_sdk,
            key: dest_key,
            buf,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            etag: reply.etag,
        });
    });

    mocha.it('rejects copy from an unrestored archive source with InvalidObjectState', async function() {
        const { msc } = get_new_multi_storage_class_namespace();
        const source_key = 'copy/unrestored-src';
        const dest_key = 'copy/unrestored-dst';
        const buf = Buffer.from('unrestored');

        await upload_buf(msc, object_sdk, { key: source_key, buf, storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE });
        const source_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key: source_key });

        await assert.rejects(
            copy_via_stream_fallback(msc, object_sdk, {
                source_key,
                source_md,
                dest_key,
                dest_storage_class: s3_utils.STORAGE_CLASS_STANDARD,
                buf,
            }),
            err => err instanceof S3Error && err.code === 'InvalidObjectState'
        );

        await assert.rejects(
            rpc_client.object.read_object_md({ bucket: BUCKET, key: dest_key }),
            err => err.rpc_code === 'NO_SUCH_OBJECT'
        );
    });

    }); // CopyObject (stream fallback)

    mocha.describe('read_object_stream', function() {

    mocha.it('reads STANDARD objects from the metadata namespace', async function() {
        const { msc } = get_new_multi_storage_class_namespace();
        const key = 'read/standard';
        const buf = crypto.randomBytes(40);

        await upload_buf(msc, object_sdk, { key, buf, storage_class: s3_utils.STORAGE_CLASS_STANDARD });
        const object_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });

        const read_stream = await msc.read_object_stream({ bucket: BUCKET, key, object_md }, object_sdk);
        const read_buf = await buffer_utils.read_stream_join(read_stream);
        assert.strictEqual(Buffer.compare(read_buf, buf), 0);
    });

    mocha.it('throws InvalidObjectState when archive object is not restored', async function() {
        const { msc } = get_new_multi_storage_class_namespace();
        const key = 'read/archive-ongoing';
        const buf = Buffer.from('ongoing-restore');

        await upload_buf(msc, object_sdk, { key, buf, storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE });
        const object_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });
        object_md.restore_status = { ongoing: true };

        await assert.rejects(
            msc.read_object_stream({ bucket: BUCKET, key, object_md }, object_sdk),
            err => err instanceof S3Error && err.code === 'InvalidObjectState'
        );
    });

    mocha.it('throws InvalidObjectState when archive object has no restore expired', async function() {
        const { msc } = get_new_multi_storage_class_namespace();
        const key = 'read/archive-expired-restore';
        const buf = Buffer.from('expired-restore');

        await upload_buf(msc, object_sdk, { key, buf, storage_class: s3_utils.STORAGE_CLASS_GLACIER });
        const object_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });
        object_md.restore_status = {
            ongoing: false,
            expiry_time: new Date('2000-01-01T00:00:00Z'),
        };

        await assert.rejects(
            msc.read_object_stream({ bucket: BUCKET, key, object_md }, object_sdk),
            err => err instanceof S3Error && err.code === 'InvalidObjectState'
        );
    });

    mocha.it('reads restored archive objects from the metadata namespace', async function() {
        const { msc } = get_new_multi_storage_class_namespace();
        const key = 'read/restored-archive';
        const buf = Buffer.from('restored-payload');

        // Data in NB; md marked as restored archive for the read gate.
        await upload_buf(msc, object_sdk, { key, buf, storage_class: s3_utils.STORAGE_CLASS_STANDARD });
        const object_md = await rpc_client.object.read_object_md({ bucket: BUCKET, key });
        object_md.storage_class = s3_utils.STORAGE_CLASS_DEEP_ARCHIVE;
        object_md.restore_status = {
            ongoing: false,
            expiry_time: new Date('2099-01-01T00:00:00Z'),
        };

        const read_stream = await msc.read_object_stream({ bucket: BUCKET, key, object_md }, object_sdk);
        const read_buf = await buffer_utils.read_stream_join(read_stream);
        assert.strictEqual(Buffer.compare(read_buf, buf), 0);
    });

    mocha.it('loads object_md when not provided', async function() {
        const { msc } = get_new_multi_storage_class_namespace();
        const key = 'read/load-md';
        const buf = crypto.randomBytes(24);

        await upload_buf(msc, object_sdk, { key, buf, storage_class: s3_utils.STORAGE_CLASS_STANDARD });

        const read_stream = await msc.read_object_stream({ bucket: BUCKET, key }, object_sdk);
        const read_buf = await buffer_utils.read_stream_join(read_stream);
        assert.strictEqual(Buffer.compare(read_buf, buf), 0);
    });

    }); // read_object_stream

}); // NamespaceMultiStorageClass
