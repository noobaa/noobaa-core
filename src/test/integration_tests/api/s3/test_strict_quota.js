/* Copyright (C) 2026 NooBaa */
/* eslint-disable max-lines, max-lines-per-function, no-invalid-this */
'use strict';

// A fresh Postgres can finish schema setup before the root-key mount read
// completes, and system_store then throws NON_EXISTING_ROOT_KEY. A secret in
// the environment is accepted without that mount read.
process.env.NOOBAA_ROOT_SECRET = process.env.NOOBAA_ROOT_SECRET || Buffer.alloc(32, 7).toString('base64');

// setup coretest first to prepare the env
const coretest = require('../../../utils/coretest/coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[1]] });

const assert = require('assert');
const mocha = require('mocha');
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const config = require('../../../../../config');
const P = require('../../../../util/promise');
const http_utils = require('../../../../util/http_utils');
const quota = require('./strict_quota_helpers');

const { rpc_client, EMAIL } = coretest;
const KB4 = 4096;

mocha.describe('strict bucket quota', function() {
    this.timeout(180000);

    /** @type {S3} */
    let s3;

    mocha.before(async function() {
        const account = await rpc_client.account.read_account({ email: EMAIL });
        s3 = new S3({
            endpoint: coretest.get_http_address(),
            credentials: {
                accessKeyId: account.access_keys[0].access_key.unwrap(),
                secretAccessKey: account.access_keys[0].secret_key.unwrap(),
            },
            forcePathStyle: true,
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpAgent: http_utils.get_unsecured_agent(coretest.get_http_address()),
            }),
        });
    });

    mocha.after(async function() {
        if (s3) await quota.remove_created_buckets(s3);
    });

    mocha.it('upload is refused at the size limit, and reads and deletes still work', async function() {
        const bucket = 'sq-tc07';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_strict(bucket, { bytes: KB4 * 2 });
            const first = await quota.put_object(s3, bucket, 'a', KB4, 1);
            quota.refresh_cache(bucket);
            const second = await quota.put_object(s3, bucket, 'b', KB4, 2);
            quota.refresh_cache(bucket);
            await quota.assert_usage(bucket, KB4 * 2, 2);

            await quota.expect_error(
                () => quota.put_object(s3, bucket, 'c', KB4, 3),
                'QuotaExceeded',
                403,
            );
            await quota.assert_usage(bucket, KB4 * 2, 2);

            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'a'), first);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'b'), second);
            await s3.deleteObject({ Bucket: bucket, Key: 'a' });
            await quota.expect_error(
                () => quota.read_object(s3, bucket, 'a'),
                'NoSuchKey',
                404,
            );
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'b'), second);
            await quota.assert_usage(bucket, KB4, 1);
        });
    });

    mocha.it('upload is refused when the object-count limit is reached', async function() {
        const bucket = 'sq-tc08';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_strict(bucket, { objects: 2 });
            await quota.put_object(s3, bucket, 'a', 32, 1);
            quota.refresh_cache(bucket);
            await quota.put_object(s3, bucket, 'b', 32, 2);
            quota.refresh_cache(bucket);
            await quota.assert_usage(bucket, 64, 2);

            await quota.expect_error(
                () => quota.put_object(s3, bucket, 'c', 32, 3),
                'QuotaExceeded',
                403,
            );
            await quota.assert_usage(bucket, 64, 2);
            assert.strictEqual((await quota.read_object(s3, bucket, 'a')).length, 32);
            assert.strictEqual((await quota.read_object(s3, bucket, 'b')).length, 32);
        });
    });

    mocha.it('a single big upload that does not fit is refused', async function() {
        const bucket = 'sq-tc09';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_strict(bucket, { bytes: KB4 * 2 });
            await quota.expect_error(
                () => quota.put_object(s3, bucket, 'too-big', (KB4 * 2) + KB4, 9),
                'QuotaExceeded',
                403,
            );
            await quota.assert_usage(bucket, 0, 0);
            assert.strictEqual((await quota.inventory(s3, bucket)).objects, 0);

            const body = await quota.put_object(s3, bucket, 'fits', KB4 * 2, 4);
            await quota.assert_usage(bucket, KB4 * 2, 1);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'fits'), body);
        });
    });

    mocha.it('deleting objects frees space straight away', async function() {
        const bucket = 'sq-tc10';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_strict(bucket, { bytes: KB4 * 2 });
            await quota.put_object(s3, bucket, 'a', KB4, 1);
            quota.refresh_cache(bucket);
            await quota.put_object(s3, bucket, 'b', KB4, 2);
            quota.refresh_cache(bucket);
            await quota.expect_error(
                () => quota.put_object(s3, bucket, 'c', KB4, 3),
                'QuotaExceeded',
                403,
            );

            await s3.deleteObject({ Bucket: bucket, Key: 'a' });
            // The trigger updates quotausages in the delete transaction.
            // md_aggregator is not run.
            await quota.assert_usage(bucket, KB4, 1);

            await P.delay(config.QUOTA_USAGE_CACHE_EXPIRY_MS + 150);
            const body = await quota.put_object(s3, bucket, 'c', KB4, 3);
            await quota.assert_usage(bucket, KB4 * 2, 2);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'c'), body);
            assert.strictEqual((await quota.read_object(s3, bucket, 'b')).length, KB4);
        });
    });

    mocha.it('multipart upload is refused when it would go over the limit', async function() {
        const bucket = 'sq-tc11';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_strict(bucket, { bytes: KB4 * 2 });
            const kept = await quota.put_object(s3, bucket, 'kept', KB4, 1);
            quota.refresh_cache(bucket);

            const opened = await s3.createMultipartUpload({ Bucket: bucket, Key: 'big' });
            try {
                await quota.expect_error(
                    () => quota.upload_part(s3, bucket, 'big', opened.UploadId, 1, KB4 * 2, 5),
                    'QuotaExceeded',
                    403,
                );
                await quota.assert_usage(bucket, KB4, 1);
                assert.deepStrictEqual(await quota.read_object(s3, bucket, 'kept'), kept);
            } finally {
                await s3.abortMultipartUpload({
                    Bucket: bucket,
                    Key: 'big',
                    UploadId: opened.UploadId,
                });
            }
        });
    });

    mocha.it('aborting a multipart upload gives the space back', async function() {
        const bucket = 'sq-tc12';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_strict(bucket, { bytes: KB4 * 4 });
            await quota.put_object(s3, bucket, 'kept', KB4, 1);
            quota.refresh_cache(bucket);

            const opened = await s3.createMultipartUpload({ Bucket: bucket, Key: 'parted' });
            await quota.upload_part(s3, bucket, 'parted', opened.UploadId, 1, KB4 * 2, 6);
            await quota.assert_usage(bucket, KB4 * 3, 1);

            await s3.abortMultipartUpload({
                Bucket: bucket,
                Key: 'parted',
                UploadId: opened.UploadId,
            });
            // Abort marks the upload deleted. The part rows release their bytes
            // when the object reclaimer soft-deletes them.
            await quota.reclaim_deleted();
            await quota.assert_usage(bucket, KB4, 1);

            quota.refresh_cache(bucket);
            await quota.put_object(s3, bucket, 'after', KB4 * 2, 7);
            await quota.assert_usage(bucket, KB4 * 3, 2);
        });
    });

    mocha.it('completing a multipart upload counts the object once', async function() {
        const bucket = 'sq-tc13';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_strict(bucket, { bytes: KB4 * 8 });
            const opened = await s3.createMultipartUpload({ Bucket: bucket, Key: 'whole' });
            const part1 = await quota.upload_part(s3, bucket, 'whole', opened.UploadId, 1, KB4, 1);
            const part2 = await quota.upload_part(s3, bucket, 'whole', opened.UploadId, 2, KB4, 2);
            await s3.completeMultipartUpload({
                Bucket: bucket,
                Key: 'whole',
                UploadId: opened.UploadId,
                MultipartUpload: {
                    Parts: [
                        { ETag: part1.ETag, PartNumber: 1 },
                        { ETag: part2.ETag, PartNumber: 2 },
                    ],
                },
            });

            await quota.assert_usage(bucket, KB4 * 2, 1);
            const listed = await quota.assert_matches_bucket(s3, bucket);
            assert.strictEqual(listed.objects, 1);
            assert.strictEqual(listed.versions[0].Size, KB4 * 2);
            const body = await quota.read_object(s3, bucket, 'whole');
            assert.strictEqual(body.length, KB4 * 2);
            assert.deepStrictEqual(body.subarray(0, KB4), part1.body);
            assert.deepStrictEqual(body.subarray(KB4), part2.body);
        });
    });

    mocha.it('a multipart upload started under strict quota still adds its full size after a switch to async', async function() {
        const bucket = 'sq-mpu-async';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_strict(bucket, { bytes: KB4 * 16 });
            const opened = await s3.createMultipartUpload({ Bucket: bucket, Key: 'large' });
            const part1 = await quota.upload_part(s3, bucket, 'large', opened.UploadId, 1, KB4 * 2, 1);
            // The part is counted while the upload is still open. The object is not.
            await quota.assert_usage(bucket, KB4 * 2, 0);

            await quota.set_quota_mode(bucket, 'async');
            const info = await rpc_client.bucket.read_bucket({ name: bucket });
            assert.strictEqual(info.quota.mode, undefined);
            assert.strictEqual(info.quota.size.value, 1);
            await quota.assert_usage(bucket, KB4 * 2, 0);

            // The upload began under strict, so a part finished after the switch
            // is still posted to quotausages.
            const part2 = await quota.upload_part(s3, bucket, 'large', opened.UploadId, 2, KB4 * 4, 2);
            await quota.assert_usage(bucket, KB4 * 6, 0);

            await s3.completeMultipartUpload({
                Bucket: bucket,
                Key: 'large',
                UploadId: opened.UploadId,
                MultipartUpload: {
                    Parts: [
                        { ETag: part1.ETag, PartNumber: 1 },
                        { ETag: part2.ETag, PartNumber: 2 },
                    ],
                },
            });

            await quota.assert_usage(bucket, KB4 * 6, 1);
            const listed = await quota.assert_matches_bucket(s3, bucket);
            assert.strictEqual(listed.objects, 1);
            assert.strictEqual(listed.versions[0].Size, KB4 * 6);
            const body = await quota.read_object(s3, bucket, 'large');
            assert.strictEqual(body.length, KB4 * 6);
            assert.deepStrictEqual(body.subarray(0, KB4 * 2), part1.body);
            assert.deepStrictEqual(body.subarray(KB4 * 2), part2.body);
        });
    });

    mocha.it('overwriting an object counts only the size difference', async function() {
        const bucket = 'sq-tc14';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_strict(bucket, { bytes: KB4 * 4 });
            await quota.put_object(s3, bucket, 'obj', KB4, 1);
            quota.refresh_cache(bucket);
            const replaced = await quota.put_object(s3, bucket, 'obj', KB4 * 2, 2);
            await quota.assert_usage(bucket, KB4 * 2, 1);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'obj'), replaced);

            quota.refresh_cache(bucket);
            await quota.put_object(s3, bucket, 'other', KB4 * 2, 3);
            quota.refresh_cache(bucket);
            await quota.assert_usage(bucket, KB4 * 4, 2);
            // Overwrite check for the exiting object size and add only delta for quota validation
            // here the delta(old obj size - new obj size) is -1KB
            await quota.put_object(s3, bucket, 'other', KB4, 4);
            const kept = await quota.read_object(s3, bucket, 'other');
            await quota.assert_usage(bucket, KB4 * 3, 2);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'other'), kept);
        });
    });

    mocha.it('Quota Version - with versioning enabled, every version counts', async function() {
        const bucket = 'sq-tc15-enabled';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_versioning(s3, bucket, 'Enabled');
            await quota.set_strict(bucket, { bytes: KB4 * 8 });
            const first = await quota.put_object(s3, bucket, 'key', KB4, 1);
            quota.refresh_cache(bucket);
            const second = await quota.put_object(s3, bucket, 'key', KB4, 2);
            await quota.assert_usage(bucket, KB4 * 2, 2);

            const listed = await quota.inventory(s3, bucket);
            assert.strictEqual(listed.objects, 2);
            const older = listed.versions.find(version => !version.IsLatest);
            const latest = listed.versions.find(version => version.IsLatest);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'key', older.VersionId), first);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'key', latest.VersionId), second);

            await s3.deleteObject({ Bucket: bucket, Key: 'key' });
            const after_marker = await quota.inventory(s3, bucket);
            assert.strictEqual(after_marker.delete_markers.length, 1);
            // The two data versions stay. The delete marker is a third object and no bytes.
            await quota.assert_usage(bucket, KB4 * 2, 3);

            await s3.deleteObject({
                Bucket: bucket,
                Key: 'key',
                VersionId: older.VersionId,
            });
            await quota.assert_usage(bucket, KB4, 2);
            assert.deepStrictEqual(
                await quota.read_object(s3, bucket, 'key', latest.VersionId),
                second,
            );

            await s3.deleteObject({
                Bucket: bucket,
                Key: 'key',
                VersionId: after_marker.delete_markers[0].VersionId,
            });
            await quota.assert_usage(bucket, KB4, 1);
        });
    });

    mocha.it('Quota Version - with versioning suspended, every version counts', async function() {
        const bucket = 'sq-tc15-suspended';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_versioning(s3, bucket, 'Enabled');
            await quota.set_strict(bucket, { bytes: KB4 * 8 });
            const versioned = await quota.put_object(s3, bucket, 'key', KB4, 1);
            const version_id = (await quota.inventory(s3, bucket)).versions[0].VersionId;
            await quota.set_versioning(s3, bucket, 'Suspended');
            quota.refresh_cache(bucket);
            await quota.put_object(s3, bucket, 'key', KB4, 2);
            await quota.assert_usage(bucket, KB4 * 2, 2);

            quota.refresh_cache(bucket);
            const replaced_null = await quota.put_object(s3, bucket, 'key', KB4 * 2, 3);
            await quota.assert_usage(bucket, KB4 * 3, 2);
            const listed = await quota.assert_matches_bucket(s3, bucket);
            assert.strictEqual(listed.objects, 2);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'key', version_id), versioned);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'key', 'null'), replaced_null);
        });
    });

    mocha.it('a delete marker counts as one object and no bytes, even on a full bucket', async function() {
        const bucket = 'sq-delete-marker';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_versioning(s3, bucket, 'Enabled');
            await quota.set_strict(bucket, { bytes: KB4 * 8, objects: 2 });
            const first = await quota.put_object(s3, bucket, 'key', KB4, 1);
            quota.refresh_cache(bucket);
            const second = await quota.put_object(s3, bucket, 'key', KB4, 2);
            const before = await quota.inventory(s3, bucket);
            const older = before.versions.find(version => !version.IsLatest);
            const latest = before.versions.find(version => version.IsLatest);
            await quota.assert_usage(bucket, KB4 * 2, 2);

            // The object limit is full. A new key is refused, but a delete marker
            // is not an upload and must still be accepted.
            quota.refresh_cache(bucket);
            await quota.expect_error(
                () => quota.put_object(s3, bucket, 'extra', KB4, 3),
                'QuotaExceeded',
                403,
            );
            const removed = await s3.deleteObject({ Bucket: bucket, Key: 'key' });
            assert.strictEqual(removed.DeleteMarker, true);
            const marked = await quota.inventory(s3, bucket);
            assert.strictEqual(marked.delete_markers.length, 1);
            assert.strictEqual(marked.versions.length, 2);
            await quota.assert_matches_bucket(s3, bucket);
            await quota.assert_usage(bucket, KB4 * 2, 3);

            await quota.expect_error(
                () => quota.read_object(s3, bucket, 'key'),
                'NoSuchKey',
                404,
            );
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'key', older.VersionId), first);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'key', latest.VersionId), second);

            quota.refresh_cache(bucket);
            await quota.expect_error(
                () => quota.put_object(s3, bucket, 'extra', KB4, 3),
                'QuotaExceeded',
                403,
            );
            await quota.assert_usage(bucket, KB4 * 2, 3);

            await s3.deleteObject({
                Bucket: bucket,
                Key: 'key',
                VersionId: marked.delete_markers[0].VersionId,
            });
            await quota.assert_usage(bucket, KB4 * 2, 2);
            assert.strictEqual((await quota.inventory(s3, bucket)).delete_markers.length, 0);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'key'), second);

            await s3.deleteObject({
                Bucket: bucket,
                Key: 'key',
                VersionId: older.VersionId,
            });
            await quota.assert_usage(bucket, KB4, 1);
            quota.refresh_cache(bucket);
            const extra = await quota.put_object(s3, bucket, 'extra', KB4, 3);
            await quota.assert_usage(bucket, KB4 * 2, 2);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'extra'), extra);
        });
    });

    mocha.it('suspended versioning replaces the null version with a delete marker', async function() {
        const bucket = 'sq-delete-marker-suspended';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_versioning(s3, bucket, 'Enabled');
            await quota.set_strict(bucket, { bytes: KB4 * 8, objects: 4 });
            const versioned = await quota.put_object(s3, bucket, 'key', KB4, 1);
            const version_id = (await quota.inventory(s3, bucket)).versions[0].VersionId;
            await quota.set_versioning(s3, bucket, 'Suspended');
            quota.refresh_cache(bucket);
            await quota.put_object(s3, bucket, 'key', KB4 * 2, 2);
            await quota.assert_usage(bucket, KB4 * 3, 2);

            // The null version is removed and a null delete marker takes its
            // object slot, so the count stays the same and those bytes come back.
            const removed = await s3.deleteObject({ Bucket: bucket, Key: 'key' });
            assert.strictEqual(removed.DeleteMarker, true);
            assert.strictEqual(removed.VersionId, 'null');
            const marked = await quota.inventory(s3, bucket);
            assert.strictEqual(marked.delete_markers.length, 1);
            assert.strictEqual(marked.versions.length, 1);
            await quota.assert_matches_bucket(s3, bucket);
            await quota.assert_usage(bucket, KB4, 2);
            await quota.expect_error(
                () => quota.read_object(s3, bucket, 'key'),
                'NoSuchKey',
                404,
            );
            await quota.expect_error(
                () => quota.read_object(s3, bucket, 'key', 'null'),
                'NoSuchKey',
                404,
            );
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'key', version_id), versioned);

            await s3.deleteObject({ Bucket: bucket, Key: 'key', VersionId: 'null' });
            await quota.assert_usage(bucket, KB4, 1);
            assert.strictEqual((await quota.inventory(s3, bucket)).delete_markers.length, 0);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'key'), versioned);
        });
    });

    mocha.it('copy into a strict bucket obeys the limit and the counter stays correct', async function() {
        const src = 'sq-tc17-src';
        const dst = 'sq-tc17-dst';
        await quota.with_buckets(s3, [src, dst], async () => {
            const fits = await quota.put_object(s3, src, 'fits', KB4 * 2, 1);
            await quota.put_object(s3, src, 'overflow', KB4, 2);
            await quota.set_strict(dst, { bytes: KB4 * 2 });

            await s3.copyObject({
                Bucket: dst,
                Key: 'fits',
                CopySource: `/${src}/fits`,
            });
            await quota.assert_usage(dst, KB4 * 2, 1);
            assert.deepStrictEqual(await quota.read_object(s3, dst, 'fits'), fits);

            quota.refresh_cache(dst);
            await quota.expect_error(
                () => s3.copyObject({
                    Bucket: dst,
                    Key: 'overflow',
                    CopySource: `/${src}/overflow`,
                }),
                'QuotaExceeded',
                403,
            );
            await quota.assert_usage(dst, KB4 * 2, 1);
            assert.strictEqual((await quota.inventory(s3, dst)).objects, 1);
        });
    });

    mocha.it('replication into a strict bucket obeys the limit', async function() {
        const src = 'sq-tc18-src';
        const full = 'sq-tc18-full';
        const room = 'sq-tc18-room';
        await quota.with_buckets(s3, [src, full, room], async () => {
            await quota.put_object(s3, src, 'one', 64, 1);
            await quota.put_object(s3, src, 'two', 64, 2);

            await quota.set_strict(full, { objects: 1 });
            await quota.put_object(s3, full, 'keep', 16, 9);
            quota.refresh_cache(full);
            await quota.replicate(s3, src, full);
            await quota.assert_usage(full, 16, 1);
            assert.strictEqual((await quota.inventory(s3, full)).objects, 1);
            assert.strictEqual((await quota.read_object(s3, full, 'keep')).length, 16);

            await quota.set_strict(room, { objects: 5 });
            await quota.replicate(s3, src, room);
            await quota.assert_usage(room, 128, 2);
            await quota.assert_matches_bucket(s3, room);
            assert.strictEqual((await quota.read_object(s3, room, 'one')).length, 64);
            assert.strictEqual((await quota.read_object(s3, room, 'two')).length, 64);
        });
    });

    mocha.it('lifecycle expiry frees space', async function() {
        const bucket = 'sq-tc19';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_strict(bucket, { bytes: KB4 * 2, objects: 2 });
            await quota.put_object(s3, bucket, 'old-a', KB4, 1);
            quota.refresh_cache(bucket);
            await quota.put_object(s3, bucket, 'old-b', KB4, 2);
            quota.refresh_cache(bucket);
            await quota.expect_error(
                () => quota.put_object(s3, bucket, 'old-c', KB4, 3),
                'QuotaExceeded',
                403,
            );
            await quota.age_object(bucket, 'old-a', 3);
            await quota.age_object(bucket, 'old-b', 3);

            await quota.run_lifecycle(s3, bucket, 'old-');
            await quota.assert_usage(bucket, 0, 0);
            assert.strictEqual((await quota.inventory(s3, bucket)).objects, 0);

            quota.refresh_cache(bucket);
            const body = await quota.put_object(s3, bucket, 'fresh', KB4, 4);
            await quota.assert_usage(bucket, KB4, 1);
            assert.deepStrictEqual(await quota.read_object(s3, bucket, 'fresh'), body);
        });
    });

    mocha.it('the counter matches the real bucket after a mixed workload', async function() {
        const bucket = 'sq-tc20';
        const src = 'sq-tc20-src';
        await quota.with_buckets(s3, [bucket, src], async () => {
            await quota.set_strict(bucket, { bytes: KB4 * 16, objects: 20 });
            await quota.put_object(s3, bucket, 'a', KB4, 1);
            await quota.put_object(s3, bucket, 'b', KB4, 2);
            await quota.put_object(s3, bucket, 'c', KB4, 3);
            await quota.assert_usage(bucket, KB4 * 3, 3);

            quota.refresh_cache(bucket);
            await quota.put_object(s3, bucket, 'b', KB4 * 2, 4);
            await quota.assert_usage(bucket, KB4 * 4, 3);

            await s3.deleteObject({ Bucket: bucket, Key: 'c' });
            await quota.assert_usage(bucket, KB4 * 3, 2);

            const opened = await s3.createMultipartUpload({ Bucket: bucket, Key: 'd' });
            const part1 = await quota.upload_part(s3, bucket, 'd', opened.UploadId, 1, KB4, 5);
            const part2 = await quota.upload_part(s3, bucket, 'd', opened.UploadId, 2, KB4, 6);
            await s3.completeMultipartUpload({
                Bucket: bucket,
                Key: 'd',
                UploadId: opened.UploadId,
                MultipartUpload: {
                    Parts: [
                        { ETag: part1.ETag, PartNumber: 1 },
                        { ETag: part2.ETag, PartNumber: 2 },
                    ],
                },
            });
            await quota.assert_usage(bucket, KB4 * 5, 3);

            const aborted = await s3.createMultipartUpload({ Bucket: bucket, Key: 'e' });
            await quota.upload_part(s3, bucket, 'e', aborted.UploadId, 1, KB4, 7);
            await s3.abortMultipartUpload({
                Bucket: bucket,
                Key: 'e',
                UploadId: aborted.UploadId,
            });
            await quota.reclaim_deleted();
            await quota.assert_usage(bucket, KB4 * 5, 3);

            await quota.put_object(s3, src, 'copied', KB4, 8);
            quota.refresh_cache(bucket);
            await s3.copyObject({
                Bucket: bucket,
                Key: 'copied',
                CopySource: `/${src}/copied`,
            });
            await quota.assert_usage(bucket, KB4 * 6, 4);
            await quota.assert_matches_bucket(s3, bucket);

            await quota.set_strict(bucket, { bytes: KB4 * 16, objects: 4 });
            quota.refresh_cache(bucket);
            await quota.expect_error(
                () => quota.put_object(s3, bucket, 'nope', KB4, 9),
                'QuotaExceeded',
                403,
            );
            await quota.assert_matches_bucket(s3, bucket);
        });
    });

    mocha.it('parallel uploads go over the limit only by a small bounded amount', async function() {
        const bucket = 'sq-tc21';
        const limit = 4;
        const wave = 16;
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_strict(bucket, { objects: limit });
            const first = await Promise.all(Array.from({ length: wave }, (_, index) => (
                quota.put_object(s3, bucket, `p${index}`, 32, index + 1)
                    .then(() => true)
                    .catch(err => {
                        assert.strictEqual(err.Code || err.code || err.name, 'QuotaExceeded');
                        return false;
                    })
            )));
            const landed = first.filter(Boolean).length;
            const row = await quota.usage(bucket);
            assert.strictEqual(Number(row.objects), landed);
            assert.ok(landed >= limit, `expected at least ${limit} objects, got ${landed}`);
            assert.ok(landed <= wave, `landed ${landed} above the in-flight wave ${wave}`);
            const overshoot = landed - limit;
            coretest.log(`TC-21 landed ${landed} limit ${limit} overshoot ${overshoot}`);

            await P.delay(config.QUOTA_USAGE_CACHE_EXPIRY_MS + 150);
            const second = await Promise.all(Array.from({ length: wave }, (_, index) => (
                quota.put_object(s3, bucket, `q${index}`, 32, index + 1)
                    .then(() => true)
                    .catch(err => {
                        assert.strictEqual(err.Code || err.code || err.name, 'QuotaExceeded');
                        return false;
                    })
            )));
            assert.ok(second.every(ok => ok === false), 'uploads after the cache window must be refused');
            const after = await quota.usage(bucket);
            assert.strictEqual(after.objects, row.objects);
            assert.ok(overshoot <= wave, 'overshoot stays inside the single parallel wave');
            await quota.assert_matches_bucket(s3, bucket);
        });
    });


    mocha.it('async quota still rejects from the storage_stats snapshot', async function() {
        const bucket = 'sq-tc25';
        await quota.with_buckets(s3, [bucket], async () => {
            await quota.set_async_count(bucket, 2);
            await quota.put_object(s3, bucket, 'a', 32, 1);
            await quota.put_object(s3, bucket, 'b', 32, 2);

            await quota.run_async_quota_cycle();
            await quota.expect_error(
                () => quota.put_object(s3, bucket, 'c', 32, 3),
                'ObjectQuotaExceeded',
                409,
            );
            await s3.deleteObject({ Bucket: bucket, Key: 'a' });
            await quota.expect_error(
                () => quota.put_object(s3, bucket, 'd', 32, 4),
                'ObjectQuotaExceeded',
                409,
            );

            await quota.run_async_quota_cycle();
            await quota.put_object(s3, bucket, 'd', 32, 4);
            assert.strictEqual((await quota.read_object(s3, bucket, 'd')).length, 32);
            const info = await rpc_client.bucket.read_bucket({ name: bucket });
            assert.strictEqual(info.quota.quantity.value, 2);
            assert.strictEqual(info.quota.mode, undefined);
        });
    });
});
