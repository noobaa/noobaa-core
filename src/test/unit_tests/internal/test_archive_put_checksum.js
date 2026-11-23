/* Copyright (C) 2026 NooBaa */
'use strict';

const crypto = require('crypto');
const stream = require('stream');
const mocha = require('mocha');
const assert = require('assert');
const NamespaceMultiStorageClass = require('../../../sdk/namespace_multi_storage_class');
const s3_utils = require('../../../endpoint/s3/s3_utils');

/**
 * @param {object} metadata_ns
 * @param {object} archive_ns
 * @returns {NamespaceMultiStorageClass}
 */
function make_msc(metadata_ns, archive_ns) {
    return new NamespaceMultiStorageClass({
        namespace_by_storage_class: {
            [s3_utils.STORAGE_CLASS_STANDARD]: metadata_ns,
            [s3_utils.STORAGE_CLASS_GLACIER]: archive_ns,
            [s3_utils.STORAGE_CLASS_DEEP_ARCHIVE]: archive_ns,
        },
    });
}

mocha.describe('archive PutObject checksum', function() {

    mocha.it('stores the SHA-512 digest computed while the archive upload reads the body', async function() {
        const body = Buffer.from('archive-body');
        const expected = crypto.createHash('sha512').update(body).digest('base64');
        let create_params;
        let complete_params;
        const metadata_ns = {
            async create_object_upload(params) {
                create_params = params;
                return { obj_id: 'obj-1', bucket_id: 'bucket-1' };
            },
            async complete_object_upload(params) {
                complete_params = params;
                return { etag: 'etag', checksum_params: params.checksum_params };
            },
        };
        const archive_ns = {
            async upload_object(params) {
                for await (const chunk of params.source_stream) {
                    assert.ok(chunk.length > 0);
                }
                return { etag: 'etag', last_modified_time: new Date('2026-01-01T00:00:00Z') };
            },
        };
        const msc = make_msc(metadata_ns, archive_ns);
        const reply = await msc.upload_object({
            bucket: 'bucket',
            key: 'key',
            size: body.length,
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
            checksum_params: {
                checksum_algorithm: 'SHA512',
                checksum_value: expected,
            },
            source_stream: stream.Readable.from([body]),
        }, {});

        assert.strictEqual(create_params.checksum_params, undefined);
        assert.deepStrictEqual(complete_params.checksum_params, {
            checksum_algorithm: 'SHA512',
            checksum_value: expected,
            checksum_type: 'FULL_OBJECT',
        });
        assert.deepStrictEqual(reply.checksum_params, complete_params.checksum_params);
    });

    mocha.it('returns BadDigest and does not complete when the archive checksum does not match', async function() {
        const body = Buffer.from('archive-body');
        const wrong = crypto.createHash('sha512').update('other-body').digest('base64');
        let completed = false;
        let aborted = false;
        const metadata_ns = {
            async create_object_upload() {
                return { obj_id: 'obj-1', bucket_id: 'bucket-1' };
            },
            async complete_object_upload() {
                completed = true;
                return { etag: 'etag' };
            },
            async abort_object_upload() {
                aborted = true;
            },
        };
        const archive_ns = {
            async upload_object(params) {
                for await (const chunk of params.source_stream) {
                    assert.ok(chunk);
                }
                return { etag: 'etag', last_modified_time: new Date('2026-01-01T00:00:00Z') };
            },
        };
        const msc = make_msc(metadata_ns, archive_ns);
        await assert.rejects(
            () => msc.upload_object({
                bucket: 'bucket',
                key: 'key',
                size: body.length,
                storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
                checksum_params: {
                    checksum_algorithm: 'SHA512',
                    checksum_value: wrong,
                },
                source_stream: stream.Readable.from([body]),
            }, {}),
            err => err.rpc_code === 'BAD_DIGEST_CHECKSUM'
        );
        assert.strictEqual(completed, false);
        assert.strictEqual(aborted, true);
    });

    mocha.it('does not store a checksum when the request has none', async function() {
        let complete_params;
        const metadata_ns = {
            async create_object_upload() {
                return { obj_id: 'obj-1', bucket_id: 'bucket-1' };
            },
            async complete_object_upload(params) {
                complete_params = params;
                return { etag: 'etag' };
            },
        };
        const archive_ns = {
            async upload_object() {
                return { etag: 'etag', last_modified_time: new Date('2026-01-01T00:00:00Z') };
            },
        };
        const msc = make_msc(metadata_ns, archive_ns);
        await msc.upload_object({
            bucket: 'bucket',
            key: 'key',
            size: 4,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            source_stream: stream.Readable.from([Buffer.from('body')]),
        }, {});

        assert.strictEqual(complete_params.checksum_params, undefined);
    });
});

mocha.describe('archive multipart checksum', function() {

    mocha.it('rejects a SHA-512 multipart create to Glacier before creating the upload', async function() {
        let created = false;
        const metadata_ns = {
            async create_object_upload() {
                created = true;
                return { obj_id: 'obj-1', bucket_id: 'bucket-1' };
            },
        };
        const archive_ns = {
            async create_object_upload() {
                created = true;
                return { obj_id: 'archive-1' };
            },
        };
        const msc = make_msc(metadata_ns, archive_ns);
        await assert.rejects(
            () => msc.create_object_upload({
                bucket: 'bucket',
                key: 'key',
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                checksum_params: { checksum_algorithm: 'SHA512' },
            }, {}),
            err => err.code === 'NotImplemented'
        );
        assert.strictEqual(created, false);
    });

    mocha.it('rejects a SHA-512 multipart create to Deep Archive before creating the upload', async function() {
        let created = false;
        const metadata_ns = {
            async create_object_upload() {
                created = true;
            },
        };
        const msc = make_msc(metadata_ns, {});
        await assert.rejects(
            () => msc.create_object_upload({
                bucket: 'bucket',
                key: 'key',
                storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
                checksum_params: { checksum_algorithm: 'SHA512' },
            }, {}),
            err => err.code === 'NotImplemented'
        );
        assert.strictEqual(created, false);
    });

    mocha.it('allows a Glacier multipart create when the request has no checksum', async function() {
        let created = false;
        const metadata_ns = {
            async create_object_upload() {
                created = true;
                return { obj_id: 'obj-1', bucket_id: 'bucket-1' };
            },
        };
        const archive_ns = {
            async create_object_upload() {
                return { obj_id: 'archive-1' };
            },
        };
        const msc = make_msc(metadata_ns, archive_ns);
        const reply = await msc.create_object_upload({
            bucket: 'bucket',
            key: 'key',
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
        }, {
            rpc_client: { object: { update_object_md() { return undefined; } } },
        });
        assert.strictEqual(created, true);
        assert.strictEqual(reply.obj_id, 'obj-1');
    });
});
