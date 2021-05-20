/* Copyright (C) 2020 NooBaa */
'use strict';


const mocha = require('mocha');
const util = require('util');
const crypto = require('crypto');
const assert = require('assert');
const fs_utils = require('../../util/fs_utils');
const nb_native = require('../../util/nb_native');
const NamespaceFS = require('../../sdk/namespace_fs');
const buffer_utils = require('../../util/buffer_utils');
const test_ns_list_objects = require('./test_ns_list_objects');
const _ = require('lodash');
const P = require('../../util/promise');

const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr });

const DEFAULT_FS_CONFIG = {
    uid: process.getuid(),
    gid: process.getgid(),
    backend: ''
};

mocha.describe('namespace_fs', function() {

    const src_bkt = 'src';
    const upload_bkt = 'test_ns_uploads_object';
    const mpu_bkt = 'test_ns_multipart_upload';

    const src_key = 'test/unit_tests/test_namespace_fs.js';
    const tmp_fs_path = '/tmp/test_namespace_fs';
    const dummy_object_sdk = { requesting_account: { nsfs_account_config: { uid: process.getuid(), gid: process.getgid() } } };

    const ns_src_bucket_path = `./${src_bkt}`;
    const ns_tmp_bucket_path = `${tmp_fs_path}/${src_bkt}`;

    const ns_src = new NamespaceFS({ bucket_path: ns_src_bucket_path });
    const ns_tmp = new NamespaceFS({ bucket_path: ns_tmp_bucket_path });

    mocha.before(async () => {
        await P.all(_.map([src_bkt, upload_bkt, mpu_bkt], async buck =>
            fs_utils.create_fresh_path(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => {
        await P.all(_.map([src_bkt, upload_bkt, mpu_bkt], async buck =>
            fs_utils.folder_delete(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_path));

    mocha.describe('list_objects', function() {

        mocha.it('list src dir with delimiter', async function() {
            const res = await ns_src.list_objects({
                bucket: src_bkt,
                delimiter: '/',
            }, dummy_object_sdk);
            console.log(inspect(res, res.length));
            assert_sorted_list(res);
        });

        mocha.it('list src dir without delimiter', async function() {
            const res = await ns_src.list_objects({
                bucket: src_bkt,
            }, dummy_object_sdk);
            console.log(inspect(res, res.length));
            assert.deepStrictEqual(res.common_prefixes, []);
            assert_sorted_list(res);
        });

        mocha.it('list_object_versions', async function() {
            const res = await ns_src.list_object_versions({
                bucket: src_bkt,
                delimiter: '/',
            }, dummy_object_sdk);
            console.log(inspect(res, res.length));
            assert_sorted_list(res);
        });

        // include all the generic list tests
        test_ns_list_objects(ns_tmp, dummy_object_sdk, 'test_ns_list_objects');

        function assert_sorted_list(res) {
            let prev_key = '';
            for (const { key } of res.objects) {
                if (res.next_marker) {
                    assert(key <= res.next_marker, 'bad next_marker at key ' + key);
                }
                assert(prev_key <= key, 'objects not sorted at key ' + key);
                prev_key = key;
            }
            prev_key = '';
            for (const key of res.common_prefixes) {
                if (res.next_marker) {
                    assert(key <= res.next_marker, 'next_marker at key ' + key);
                }
                assert(prev_key <= key, 'prefixes not sorted at key ' + key);
                prev_key = key;
            }
        }
    });

    mocha.it('read_object_md', async function() {
        const res = await ns_src.read_object_md({
            bucket: src_bkt,
            key: src_key,
        }, dummy_object_sdk);
        console.log(inspect(res));
    });

    mocha.it('read_object_md fails on directory head', async function() {
        try {
            await ns_src.read_object_md({
                bucket: src_bkt,
                key: src_key.substr(0, src_key.lastIndexOf('/')),
            }, dummy_object_sdk);
            throw new Error('Should have failed on head of directory');
        } catch (error) {
            assert.strict.equal(error.message, 'NoSuchKey');
            assert.strict.equal(error.code, 'ENOENT');
            assert.strict.equal(error.rpc_code, 'NO_SUCH_OBJECT');
        }
    });

    mocha.describe('read_object_stream', function() {

        mocha.it('read full', async function() {
            const out = buffer_utils.write_stream();
            await ns_src.read_object_stream({
                bucket: src_bkt,
                key: src_key,
            }, dummy_object_sdk, out);
            const res = out.join().toString();
            assert.strict.equal(res.slice(13, 28), '(C) 2020 NooBaa');
            assert.strict.equal(res.slice(37, 43), 'strict');
        });

        mocha.it('read range', async function() {
            const out = buffer_utils.write_stream();
            await ns_src.read_object_stream({
                bucket: src_bkt,
                key: src_key,
                start: 13,
                end: 28,
            }, dummy_object_sdk, out);
            const res = out.join().toString();
            assert.strict.equal(res, '(C) 2020 NooBaa');
        });

        mocha.it('read range above size', async function() {
            const too_high = 1000000000;
            const out = buffer_utils.write_stream();
            await ns_src.read_object_stream({
                bucket: src_bkt,
                key: src_key,
                start: too_high,
                end: too_high + 10,
            }, dummy_object_sdk, out);
            const res = out.join().toString();
            assert.strict.equal(res, '');
        });
    });

    mocha.describe('upload_object', function() {

        const upload_key = 'upload_key_1';

        mocha.it('upload, read, delete of a small object', async function() {
            const data = crypto.randomBytes(100);
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object response', inspect(upload_res));

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk, read_res);
            console.log('read_object_stream response', inspect(read_res));
            const read_data = read_res.join();
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk);
            console.log('delete_object response', inspect(delete_res));
        });
    });

    mocha.describe('multipart upload', function() {

        const mpu_key = 'mpu_upload';

        mocha.it('upload, read, delete a small multipart object', async function() {
            this.timeout(20000); // eslint-disable-line no-invalid-this

            const create_res = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: mpu_key,
            }, dummy_object_sdk);
            console.log('create_object_upload response', inspect(create_res));

            const obj_id = create_res.obj_id;
            const num_parts = 10;
            const part_size = 1024 * 1024;
            const data = crypto.randomBytes(num_parts * part_size);
            const multiparts = [];
            for (let i = 0; i < num_parts; ++i) {
                const data_part = data.slice(i * part_size, (i + 1) * part_size);
                const part_res = await ns_tmp.upload_multipart({
                    obj_id,
                    bucket: mpu_bkt,
                    key: mpu_key,
                    num: i + 1,
                    source_stream: buffer_utils.buffer_to_read_stream(data_part),
                }, dummy_object_sdk);
                console.log('upload_multipart response', inspect(part_res));
                multiparts.push({ num: i + 1, etag: part_res.etag });

                const list_parts_res = await ns_tmp.list_multiparts({
                    obj_id,
                    bucket: mpu_bkt,
                    key: mpu_key,
                }, dummy_object_sdk);
                console.log('list_multiparts response', inspect(list_parts_res));
            }

            const list1_res = await ns_src.list_uploads({
                bucket: mpu_bkt,
            }, dummy_object_sdk);
            console.log('list_uploads response', inspect(list1_res));
            // TODO list_uploads is not implemented
            assert.deepStrictEqual(list1_res.objects, []);
            // assert.strictEqual(list1_res.objects.length, 1);
            // assert.strictEqual(list1_res.objects[0].key, mpu_key);

            const complete_res = await ns_tmp.complete_object_upload({
                obj_id,
                bucket: mpu_bkt,
                key: mpu_key,
                multiparts,
            }, dummy_object_sdk);
            console.log('complete_object_upload response', inspect(complete_res));

            const list2_res = await ns_src.list_uploads({
                bucket: mpu_bkt,
            }, dummy_object_sdk);
            console.log('list_uploads response', inspect(list2_res));
            assert.deepStrictEqual(list2_res.objects, []);

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: mpu_bkt,
                key: mpu_key,
            }, dummy_object_sdk, read_res);
            console.log('read_object_stream response', inspect(read_res));
            const read_data = read_res.join();
            // for (let i = 0; i < data.length; ++i) {
            //     assert.strictEqual(read_data[i], data[i],
            //         `i=${i} read=${read_data[i].toString(16)}, data=${data[i].toString(16)}`);
            // }
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const delete_res = await ns_tmp.delete_object({
                bucket: mpu_bkt,
                key: mpu_key,
            }, dummy_object_sdk);
            console.log('delete_object response', inspect(delete_res));
        });
    });

    mocha.describe('delete_object', function() {

        const dir_1 = '/a/b/c/';
        const dir_2 = '/a/b/';
        const upload_key_1 = dir_1 + 'upload_key_1';
        const upload_key_2 = dir_1 + 'upload_key_2';
        const upload_key_3 = dir_2 + 'upload_key_3';
        const data = crypto.randomBytes(100);

        mocha.before(async function() {
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_1,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object with path (before) response', inspect(upload_res));
        });

        mocha.it('do not delete the path', async function() {
            const copy_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_2,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object with path response', inspect(copy_res));

            const delete_copy_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_2,
            }, dummy_object_sdk);
            console.log('delete_object do not delete the path response', inspect(delete_copy_res));

            let entries;
            try {
                entries = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, ns_tmp_bucket_path + dir_1);
            } catch (e) {
                assert.ifError(e);
            }
            console.log('do not delete the path - entries', entries);
            assert.strictEqual(entries.length, 1);
        });


        mocha.it('delete the path - stop when not empty', async function() {
            const copy_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_3,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object with path response', inspect(copy_res));

            const delete_copy_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_1,
            }, dummy_object_sdk);
            console.log('delete_object - stop when not empty response', inspect(delete_copy_res));

            let entries;
            try {
                entries = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, ns_tmp_bucket_path + dir_2);
            } catch (e) {
                assert.ifError(e);
            }
            console.log('stop when not empty - entries', entries);
            assert.strictEqual(entries.length, 1);

        });

        mocha.after(async function() {
            let entries_before;
            let entries_after;
            try {
                entries_before = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, ns_tmp_bucket_path);

                const delete_res = await ns_tmp.delete_object({
                    bucket: upload_bkt,
                    key: upload_key_3,
                }, dummy_object_sdk);
                console.log('delete_object response', inspect(delete_res));

                entries_after = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, ns_tmp_bucket_path);
            } catch (e) {
                assert.ifError(e);
            }
            assert.strictEqual(entries_after.length, entries_before.length - 1);
        });
    });

    mocha.describe('key with trailing /', function() {

        const dir_1 = '/a/b/c/';
        const dir_2 = '/a/b/';
        const upload_key_1 = dir_1 + 'upload_key_1/';
        const upload_key_2 = dir_2 + 'upload_key_2/';
        const data = crypto.randomBytes(100);

        mocha.before(async function() {
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_1,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object with trailing / response', inspect(upload_res));
        });

        mocha.it(`delete the path - stop when not empty and key with trailing /`, async function() {
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_2,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object with trailing / (key 2) response', inspect(upload_res));

            const delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_1,
            }, dummy_object_sdk);
            console.log('delete_object with trailing / response', inspect(delete_res));
        });

        mocha.after(async function() {
            const delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_2,
            }, dummy_object_sdk);
            console.log('delete_object with trailing / (key 2) response', inspect(delete_res));
        });
    });

});

mocha.describe('namespace_fs copy object', function() {

    const src_bkt = 'src';
    const upload_bkt = 'test_ns_uploads_object';
    const tmp_fs_path = '/tmp/test_namespace_fs';
    const dummy_object_sdk = { requesting_account: { nsfs_account_config: { uid: process.getuid(), gid: process.getgid() } } };

    const ns_tmp_bucket_path = `${tmp_fs_path}/${src_bkt}`;

    const ns_tmp = new NamespaceFS({ bucket_path: ns_tmp_bucket_path });

    mocha.before(async () => {
        await P.all(_.map([src_bkt, upload_bkt], async buck =>
            fs_utils.create_fresh_path(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => {
        await P.all(_.map([src_bkt, upload_bkt], async buck =>
            fs_utils.folder_delete(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_path));

    mocha.describe('upload_object (copy)', function() {
        const upload_key = 'upload_key_1';
        const copy_key_1 = 'copy_key_1';
        const data = crypto.randomBytes(100);

        mocha.before(async function() {
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object response', inspect(upload_res));
        });

        mocha.it('copy, read of a small object copy', async function() {
            const copy_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: copy_key_1,
                copy_source: {
                    key: upload_key,
                }
            }, dummy_object_sdk);
            console.log('upload_object (copy) response', inspect(copy_res));

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: copy_key_1,
            }, dummy_object_sdk, read_res);
            console.log('read_object_stream (copy) response', inspect(read_res));
            const read_data = read_res.join();
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const delete_copy_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: copy_key_1,
            }, dummy_object_sdk);
            console.log('delete_object (copy) response', inspect(delete_copy_res));
        });

        mocha.it('copy, read of the small object twice to the same file name', async function() {
            let copy_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: copy_key_1,
                copy_source: {
                    key: upload_key,
                }
            }, dummy_object_sdk);
            console.log('upload_object: copy twice (1) to the same file name response', inspect(copy_res));

            copy_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: copy_key_1,
                copy_source: {
                    key: upload_key,
                }
            }, dummy_object_sdk);
            console.log('upload_object: copy twice (2) to the same file name response', inspect(copy_res));

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: copy_key_1,
            }, dummy_object_sdk, read_res);
            console.log('read_object_stream: copy twice to the same file name response', inspect(read_res));
            const read_data = read_res.join();
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const delete_copy_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: copy_key_1,
            }, dummy_object_sdk);
            console.log('delete_object: copy twice to the same file name response', inspect(delete_copy_res));
        });

        mocha.it('copy, read of the small object without using link', async function() {
            const copy_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: copy_key_1,
                xattr_copy: false,
                copy_source: {
                    key: upload_key,
                }
            }, dummy_object_sdk);
            console.log('upload_object: copy without using link response', inspect(copy_res));

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: copy_key_1,
            }, dummy_object_sdk, read_res);
            console.log('read_object_stream: copy without using link response', inspect(read_res));
            const read_data = read_res.join();
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const delete_copy_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: copy_key_1,
            }, dummy_object_sdk);
            console.log('delete_object: copy without using link response', inspect(delete_copy_res));
        });

        mocha.after(async function() {
            const delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk);
            console.log('delete_object response', inspect(delete_res));
        });
    });

});
