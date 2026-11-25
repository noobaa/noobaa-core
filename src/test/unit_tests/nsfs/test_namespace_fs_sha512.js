/* Copyright (C) 2026 NooBaa */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const mocha = require('mocha');
const assert = require('assert');
const NamespaceFS = require('../../../sdk/namespace_fs');
const checksum_utils = require('../../../util/checksum_utils');
const buffer_utils = require('../../../util/buffer_utils');

function sha512_b64(data) {
    return crypto.createHash('sha512').update(data).digest('base64');
}

function dummy_object_sdk() {
    return {
        requesting_account: {
            force_md5_etag: false,
            nsfs_account_config: {
                uid: process.getuid(),
                gid: process.getgid(),
            },
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        },
        read_bucket_full_info() {
            return {};
        },
    };
}

mocha.describe('namespace_fs SHA-512', function() {
    const bucket = 'sha512-bucket';
    let root;
    let ns;
    let object_sdk;

    mocha.beforeEach(function() {
        // macOS /var is a symlink. The boundary check compares real paths.
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nsfs-sha512-')));
        ns = new NamespaceFS({
            bucket_path: path.join(root, bucket),
            bucket_id: 'sha512-bucket-id',
            namespace_resource_id: undefined,
            access_mode: undefined,
            versioning: 'DISABLED',
            force_md5_etag: false,
            stats: undefined,
        });
        fs.mkdirSync(ns.bucket_path);
        object_sdk = dummy_object_sdk();
    });

    mocha.afterEach(function() {
        fs.rmSync(root, { recursive: true, force: true });
    });

    mocha.it('stores a matching SHA-512 digest', async function() {
        const data = Buffer.from('hello-sha512');
        const digest = sha512_b64(data);
        const upload_res = await ns.upload_object({
            bucket,
            key: 'plain',
            source_stream: buffer_utils.buffer_to_read_stream(data),
            checksum_params: {
                checksum_algorithm: 'SHA512',
                checksum_value: digest,
            },
        }, object_sdk);
        assert.strictEqual(upload_res.checksum_params.checksum_value, digest);
        assert.strictEqual(upload_res.checksum_params.checksum_type, 'FULL_OBJECT');

        const md = await ns.read_object_md({ bucket, key: 'plain' }, object_sdk);
        assert.strictEqual(md.checksum_algorithm, 'SHA512');
        assert.strictEqual(md.checksum_value, digest);
        assert.strictEqual(md.checksum_type, 'FULL_OBJECT');
        assert.strictEqual(md.checksum.ChecksumSHA512, digest);
        assert.strictEqual(md.checksum.ChecksumType, 'FULL_OBJECT');
    });

    mocha.it('rejects a SHA-512 digest that does not match', async function() {
        const data = Buffer.from('hello-sha512');
        await assert.rejects(
            ns.upload_object({
                bucket,
                key: 'bad',
                source_stream: buffer_utils.buffer_to_read_stream(data),
                checksum_params: {
                    checksum_algorithm: 'SHA512',
                    checksum_value: sha512_b64('other'),
                },
            }, object_sdk),
            err => err.rpc_code === 'BAD_DIGEST_CHECKSUM',
        );
    });

    mocha.it('keeps a composite checksum on a full copy', async function() {
        const data = Buffer.from('copied-bytes');
        const composite = checksum_utils.build_composite_checksum('SHA512', [sha512_b64('part-a')]);
        const upload_res = await ns.upload_object({
            bucket,
            key: 'copied',
            source_stream: buffer_utils.buffer_to_read_stream(data),
            checksum_params: {
                checksum_algorithm: 'SHA512',
                checksum_value: composite,
                checksum_type: 'COMPOSITE',
            },
        }, object_sdk);
        assert.strictEqual(upload_res.checksum_params.checksum_value, composite);
        assert.strictEqual(upload_res.checksum_params.checksum_type, 'COMPOSITE');

        const md = await ns.read_object_md({ bucket, key: 'copied' }, object_sdk);
        assert.strictEqual(md.checksum_value, composite);
        assert.strictEqual(md.checksum_type, 'COMPOSITE');
    });

    mocha.it('stores a composite of the part digests', async function() {
        const parts = [Buffer.from('aaaa'), Buffer.from('bbbb')];
        const create_res = await ns.create_object_upload({
            bucket,
            key: 'multi',
            checksum_params: { checksum_algorithm: 'SHA512' },
        }, object_sdk);
        const multiparts = [];
        for (let i = 0; i < parts.length; ++i) {
            const part_res = await ns.upload_multipart({
                obj_id: create_res.obj_id,
                bucket,
                key: 'multi',
                num: i + 1,
                size: parts[i].length,
                source_stream: buffer_utils.buffer_to_read_stream(parts[i]),
            }, object_sdk);
            assert.strictEqual(part_res.checksum_params.checksum_value, sha512_b64(parts[i]));
            assert.strictEqual(part_res.checksum_params.checksum_type, undefined);
            multiparts.push({ num: i + 1, etag: part_res.etag });
        }
        const listed = await ns.list_multiparts({
            obj_id: create_res.obj_id,
            bucket,
            key: 'multi',
        }, object_sdk);
        assert.deepStrictEqual(
            listed.multiparts.map(part => part.checksum_value).sort(),
            parts.map(sha512_b64).sort(),
        );
        const complete_res = await ns.complete_object_upload({
            obj_id: create_res.obj_id,
            bucket,
            key: 'multi',
            multiparts,
        }, object_sdk);
        const expected = checksum_utils.build_composite_checksum('SHA512', parts.map(sha512_b64));
        assert.strictEqual(complete_res.checksum_params.checksum_value, expected);
        assert.strictEqual(complete_res.checksum_params.checksum_type, 'COMPOSITE');

        const md = await ns.read_object_md({ bucket, key: 'multi' }, object_sdk);
        assert.strictEqual(md.checksum_value, expected);
        assert.strictEqual(md.checksum_type, 'COMPOSITE');
    });

    mocha.it('hashes a copied part instead of keeping the source composite', async function() {
        const part = Buffer.from('copied-part');
        const source_composite = checksum_utils.build_composite_checksum('SHA512', [sha512_b64('source-object')]);
        const create_res = await ns.create_object_upload({
            bucket,
            key: 'part-copy',
            checksum_params: { checksum_algorithm: 'SHA512' },
        }, object_sdk);
        const part_res = await ns.upload_multipart({
            obj_id: create_res.obj_id,
            bucket,
            key: 'part-copy',
            num: 1,
            size: part.length,
            source_stream: buffer_utils.buffer_to_read_stream(part),
            checksum_params: {
                checksum_algorithm: 'SHA512',
                checksum_value: source_composite,
                checksum_type: 'COMPOSITE',
            },
        }, object_sdk);
        assert.strictEqual(part_res.checksum_params.checksum_value, sha512_b64(part));
        assert.strictEqual(part_res.checksum_params.checksum_type, undefined);
    });
});
