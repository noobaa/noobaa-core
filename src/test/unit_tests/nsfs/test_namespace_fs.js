/* Copyright (C) 2020 NooBaa */
/*eslint max-lines-per-function: ["error", 1300]*/
/*eslint max-lines: ["error", 2600]*/
'use strict';

const _ = require('lodash');
const fs = require('fs');
const util = require('util');
const path = require('path');
const mocha = require('mocha');
const crypto = require('crypto');
const assert = require('assert');
const os = require('os');
const P = require('../../../util/promise');
const config = require('../../../../config');
const os_utils = require('../../../util/os_utils');
const fs_utils = require('../../../util/fs_utils');
const nb_native = require('../../../util/nb_native');
const NamespaceFS = require('../../../sdk/namespace_fs');
const s3_utils = require('../../../endpoint/s3/s3_utils');
const buffer_utils = require('../../../util/buffer_utils');
const { S3Error } = require('../../../endpoint/s3/s3_errors');
const test_ns_list_objects = require('../api/s3/test_ns_list_objects');
const { TMP_PATH } = require('../../system_tests/test_utils');
const { get_process_fs_context } = require('../../../util/native_fs_utils');
const endpoint_stats_collector = require('../../../sdk/endpoint_stats_collector');
const SensitiveString = require('../../../util/sensitive_string');

const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr });

const mkdtemp = util.promisify(fs.mkdtemp);

// TODO: In order to verify validity add content_md5_mtime as well
const XATTR_MD5_KEY = 'content_md5';
const XATTR_DIR_CONTENT = 'user.noobaa.dir_content';
const XATTR_CONTENT_TYPE = 'user.noobaa.content_type';

const dir_content_type = 'application/x-directory';
const stream_content_type = 'application/octet-stream';

const DEFAULT_FS_CONFIG = get_process_fs_context();
const empty_data = crypto.randomBytes(0);
const empty_stream = () => buffer_utils.buffer_to_read_stream(empty_data);

function make_dummy_object_sdk(config_root) {
    return {
        requesting_account: {
            force_md5_etag: false,
            nsfs_account_config: {
                uid: process.getuid(),
                gid: process.getgid(),
            }
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        },

        read_bucket_sdk_config_info(name) {
            return {
                bucket_owner: new SensitiveString('dummy-owner'),
                owner_account: {
                    id: 'dummy-id-123',
                }
            };
        },
        read_bucket_full_info(name) {
            return {};
        }
    };
}

mocha.describe('namespace_fs', function() {

    const src_bkt = 'src';
    const upload_bkt = 'test_ns_uploads_object';
    const mpu_bkt = 'test_ns_multipart_upload';

    const src_key = 'test/unit_tests/nsfs/test_namespace_fs.js';
    const tmp_fs_path = path.join(TMP_PATH, 'test_namespace_fs');
    const dummy_object_sdk = make_dummy_object_sdk(tmp_fs_path);
    const ns_src_bucket_path = `./${src_bkt}`;
    const ns_tmp_bucket_path = `${tmp_fs_path}/${src_bkt}`;

    const ns_src = new NamespaceFS({
        bucket_path: ns_src_bucket_path,
        bucket_id: '1',
        namespace_resource_id: undefined,
        access_mode: undefined,
        versioning: undefined,
        force_md5_etag: false,
        stats: endpoint_stats_collector.instance(),
    });
    const ns_tmp = new NamespaceFS({
        bucket_path: ns_tmp_bucket_path,
        bucket_id: '2',
        namespace_resource_id: undefined,
        access_mode: undefined,
        versioning: undefined,
        force_md5_etag: false,
        stats: endpoint_stats_collector.instance(),
    });

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

    mocha.it('read_object_md succeed on directory head - not directory object - should fail', async function() {
        try {
            const res = await ns_src.read_object_md({
                bucket: src_bkt,
                key: src_key.substr(0, src_key.lastIndexOf('/')),
            }, dummy_object_sdk);
            console.log(inspect(res));
            assert.fail('head should have failed with no such key');
        } catch (err) {
            assert.equal(err.code, 'ENOENT');
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
            assert.strict.equal(res.slice(34, 40), 'eslint');
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
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;

        mocha.it('upload, read, delete of a small object', async function() {
            const data = crypto.randomBytes(100);
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                xattr,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object response', inspect(upload_res));
            if (config.NSFS_CALCULATE_MD5 ||
                ns_tmp.force_md5_etag || dummy_object_sdk.requesting_account.force_md5_etag) xattr[XATTR_MD5_KEY] = upload_res.etag;

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk, read_res);
            console.log('read_object_stream response', inspect(read_res));
            const read_data = read_res.join();
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const md = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk);
            console.log('read_object_md response', inspect(md));
            assert.deepStrictEqual(xattr, md.xattr);

            const delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk);
            console.log('delete_object response', inspect(delete_res));
        });
    });

    mocha.describe('multipart upload', function() {

        const mpu_key = 'mpu_upload';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
        ns_tmp.force_md5_etag = true;
        ns_src.force_md5_etag = true;
        dummy_object_sdk.requesting_account.force_md5_etag = true;

        mocha.it('upload, read, delete a small multipart object', async function() {
            this.timeout(20000); // eslint-disable-line no-invalid-this

            const create_res = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: mpu_key,
                xattr,
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

            const list1_res = await ns_tmp.list_uploads({
                bucket: mpu_bkt,
            }, dummy_object_sdk);
            console.log('list_uploads response', inspect(list1_res));
            assert.strictEqual(list1_res.objects.length, 1);
            assert.strictEqual(list1_res.objects[0].key, mpu_key);

            const complete_res = await ns_tmp.complete_object_upload({
                obj_id,
                bucket: mpu_bkt,
                key: mpu_key,
                multiparts,
            }, dummy_object_sdk);
            console.log('complete_object_upload response', inspect(complete_res));
            if (config.NSFS_CALCULATE_MD5 ||
                ns_tmp.force_md5_etag || dummy_object_sdk.requesting_account.force_md5_etag) xattr[XATTR_MD5_KEY] = complete_res.etag;

            const list2_res = await ns_tmp.list_uploads({
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
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const md = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: mpu_key,
            }, dummy_object_sdk);
            console.log('read_object_md response', inspect(md));
            assert.deepStrictEqual(xattr, md.xattr);

            const delete_res = await ns_tmp.delete_object({
                bucket: mpu_bkt,
                key: mpu_key,
            }, dummy_object_sdk);
            console.log('delete_object response', inspect(delete_res));
        });

        mocha.it('multipart upload non continuous upload', async function() {
            this.timeout(20000); // eslint-disable-line no-invalid-this

            const create_res = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: mpu_key,
                xattr,
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
                multiparts.push({ num: i + 1, etag: part_res.etag });
            }
            // remove part 5 and 7
            multiparts.splice(4, 1); //part 5
            multiparts.splice(5, 1); //part 7 (now part 6 as 5 was removed)

            await ns_tmp.complete_object_upload({
                obj_id,
                bucket: mpu_bkt,
                key: mpu_key,
                multiparts,
            }, dummy_object_sdk);

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: mpu_bkt,
                key: mpu_key,
            }, dummy_object_sdk, read_res);
            const read_data = read_res.join();
            assert.strictEqual(Buffer.compare(read_data.slice(0, 4 * part_size), data.slice(0, 4 * part_size)), 0);
            assert.strictEqual(Buffer.compare(read_data.slice(4 * part_size, 5 * part_size), data.slice(5 * part_size, 6 * part_size)), 0);
            assert.strictEqual(Buffer.compare(read_data.slice(5 * part_size), data.slice(7 * part_size)), 0);
        });
    });

    mocha.describe('list multipart upload', function() {
        const mpu_key = 'mpu_upload';
        const mpu_key2 = 'multipart/mpu_upload';
        const mpu_key3 = 'multipart/tmp/mpu_upload';
        const prefix = 'multipart/';
        const delimiter = '/';
        let create_res1;
        let create_res2;
        let create_res3;

        const xattr = { key: 'value', key2: 'value2' };

        mocha.before(async function() {
            create_res1 = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: mpu_key,
                xattr,
            }, dummy_object_sdk);

            create_res2 = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: mpu_key2,
                xattr,
            }, dummy_object_sdk);

            create_res3 = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: mpu_key3,
                xattr,
            }, dummy_object_sdk);
        });

        mocha.after(async function() {
            await ns_tmp.abort_object_upload({bucket: mpu_bkt, obj_id: create_res1.obj_id}, dummy_object_sdk);
            await ns_tmp.abort_object_upload({bucket: mpu_bkt, obj_id: create_res2.obj_id}, dummy_object_sdk);
            await ns_tmp.abort_object_upload({bucket: mpu_bkt, obj_id: create_res3.obj_id}, dummy_object_sdk);
        });

        mocha.it('multipartUploadList without prefix or delimiter', async function() {
            const res = await ns_tmp.list_uploads({bucket: mpu_bkt}, dummy_object_sdk);
            //should return all three items
            assert.strictEqual(res.objects.length, 3);
        });

        mocha.it('multipartUploadList with prefix', async function() {
            const res = await ns_tmp.list_uploads({bucket: mpu_bkt, prefix}, dummy_object_sdk);
            //should only include keys that start with prefix
            assert.strictEqual(res.objects.length, 2);
        });

        mocha.it('multipartUploadList with delimiter', async function() {
            const res = await ns_tmp.list_uploads({bucket: mpu_bkt, delimiter}, dummy_object_sdk);
            assert.strictEqual(res.objects.length, 1);
            // should combine both items with key that starts with multipart/ into common_prefixes
            assert.strictEqual(res.common_prefixes.length, 1);
            assert.strictEqual(res.common_prefixes[0], prefix);
        });

        mocha.it('multipartUploadList with prefix and delimiter', async function() {
            const res = await ns_tmp.list_uploads({bucket: mpu_bkt, prefix, delimiter}, dummy_object_sdk);
            // multipart/mpu_upload doesnt have delimiter after prefix
            assert.strictEqual(res.objects.length, 1);
            assert.strictEqual(res.objects[0].key, mpu_key2);
            //first delimiter after prifix
            assert.strictEqual(res.common_prefixes.length, 1);
            assert.strictEqual(res.common_prefixes[0], 'multipart/tmp/');
        });
    });

    mocha.describe('delete_object', function() {

        const dir_1 = '/a/b/c/';
        const dir_2 = '/a/b/';
        const dir_3 = '/x/y/z/';
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
            const source = buffer_utils.buffer_to_read_stream(data);
            await upload_object(ns_tmp, upload_bkt, upload_key_2, dummy_object_sdk, source);
            await delete_object(ns_tmp, upload_bkt, upload_key_2, dummy_object_sdk);

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
            const source = buffer_utils.buffer_to_read_stream(data);
            await upload_object(ns_tmp, upload_bkt, upload_key_3, dummy_object_sdk, source);
            await delete_object(ns_tmp, upload_bkt, upload_key_1, dummy_object_sdk);
            let entries;
            try {
                entries = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, ns_tmp_bucket_path + dir_2);
            } catch (e) {
                assert.ifError(e);
            }
            assert.strictEqual(entries.length, 1);

        });

        mocha.it('delete partial dir object without last slash version enabled - /x/y/z', async function() {
            const source = buffer_utils.buffer_to_read_stream(data);
            ns_tmp.set_bucket_versioning('ENABLED', dummy_object_sdk);
            await upload_object(ns_tmp, upload_bkt, dir_3, dummy_object_sdk, source);
            await fs_utils.file_must_exist(path.join(ns_tmp_bucket_path, '/x/y/z/', config.NSFS_FOLDER_OBJECT_NAME));
            const partial_dir_3 = dir_3.slice(0, -1); // the path without the last slash
            await delete_object(ns_tmp, upload_bkt, partial_dir_3, dummy_object_sdk);
            await fs_utils.file_must_exist(path.join(ns_tmp_bucket_path, '/x/y/z/', config.NSFS_FOLDER_OBJECT_NAME));
            await delete_object(ns_tmp, upload_bkt, dir_3, dummy_object_sdk);
        });

        mocha.it('delete dir object, version enabled - /x/y/z/', async function() {
            const source = buffer_utils.buffer_to_read_stream(data);
            ns_tmp.set_bucket_versioning('ENABLED', dummy_object_sdk);
            await upload_object(ns_tmp, upload_bkt, dir_3, dummy_object_sdk, source);
            await fs_utils.file_must_exist(path.join(ns_tmp_bucket_path, '/x/y/z/', config.NSFS_FOLDER_OBJECT_NAME));
            const resp = await delete_object(ns_tmp, upload_bkt, dir_3, dummy_object_sdk);
            await fs_utils.file_must_not_exist(path.join(ns_tmp_bucket_path, '/x/y/z/', config.NSFS_FOLDER_OBJECT_NAME));
            assert.equal(resp?.created_delete_marker, true);
            const res = await ns_tmp.list_object_versions({
                bucket: upload_bkt,
                prefix: '/x/y/'
            }, dummy_object_sdk);
            //two objects and two delete markers (one of each from last test).
            assert.equal(res.objects.length, 4);
        });

        mocha.it('delete dir object, version enabled - /x/y/z/ - multiple files', async function() {
            const source = buffer_utils.buffer_to_read_stream(data);
            const source1 = buffer_utils.buffer_to_read_stream(data);
            ns_tmp.set_bucket_versioning('ENABLED', dummy_object_sdk);
            const dir_3_object = path.join(dir_3, 'obj1');
            await upload_object(ns_tmp, upload_bkt, dir_3, dummy_object_sdk, source);
            await upload_object(ns_tmp, upload_bkt, dir_3_object, dummy_object_sdk, source1);
            await fs_utils.file_must_exist(path.join(ns_tmp_bucket_path, dir_3, config.NSFS_FOLDER_OBJECT_NAME));
            await fs_utils.file_must_exist(path.join(ns_tmp_bucket_path, dir_3_object));
            const resp = await delete_object(ns_tmp, upload_bkt, dir_3, dummy_object_sdk);
            await fs_utils.file_must_not_exist(path.join(ns_tmp_bucket_path, dir_3, config.NSFS_FOLDER_OBJECT_NAME));
            await fs_utils.file_must_exist(path.join(ns_tmp_bucket_path, dir_3));
            await fs_utils.file_must_exist(path.join(ns_tmp_bucket_path, dir_3_object));
            assert.equal(resp?.created_delete_marker, true);
            const res = await ns_tmp.list_object_versions({
                bucket: upload_bkt,
                prefix: '/x/y/'
            }, dummy_object_sdk);
            //4 from previous tests + 3 from this test(two objects and one delete marker)
            assert.equal(res.objects.length, 7);
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
            ns_tmp.set_bucket_versioning('DISABLED', dummy_object_sdk);
            assert.strictEqual(entries_after.length, entries_before.length);
        });
    });

    mocha.describe('key with trailing /', function() {

        const dir_1 = '/a/b/c/';
        const dir_2 = '/a/b/';
        const upload_key_1 = dir_1 + 'upload_key_1/';
        const upload_key_2 = dir_2 + 'upload_key_2/';
        const upload_key_empty = 'empty_key/';
        const data = crypto.randomBytes(100);

        mocha.before(async function() {
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_1,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object with trailing / response', inspect(upload_res));
        });

        mocha.it('get empty content dir', async function() {
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_empty,
                source_stream: buffer_utils.buffer_to_read_stream(crypto.randomBytes(0)),
                size: 0
            }, dummy_object_sdk);

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key_empty,
            }, dummy_object_sdk, read_res);
            assert(read_res.writableEnded);
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
            let delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_2,
            }, dummy_object_sdk);
            console.log('delete_object with trailing / (key 2) response', inspect(delete_res));

            delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_empty,
            }, dummy_object_sdk);
            console.log('delete_object with trailing / (empty content dir) response', inspect(delete_res));
        });
    });

    mocha.describe('md_conditions', function() {
        const upload_key = 'upload_key_md_conditions';
        const upload_key_non_existing = 'upload_key_md_conditions_non_existing';
        const upload_directory_key = 'upload_key_md_conditions_directory/';
        const data = crypto.randomBytes(100);

        mocha.it('upload_object with If-Match that passes', async function() {
            const upload_res_1 = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);

            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                md_conditions: {
                    if_match_etag: upload_res_1.etag,
                },
            }, dummy_object_sdk);

        });

        mocha.it('upload_object with If-Match that fails', async function() {
            const invalid_etag = 'non-matching-etag';
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data),
            }, dummy_object_sdk);

            try {
                await ns_tmp.upload_object({
                    bucket: upload_bkt,
                    key: upload_key,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    md_conditions: {
                        if_match_etag: invalid_etag,
                    },
                }, dummy_object_sdk);

                assert.fail('upload_object should fail');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'IF_MATCH_ETAG');
            }
        });

        mocha.it('upload_object with If-Match on non-existing object', async function() {
            const invalid_etag = 'non-matching-etag';
            try {
                await ns_tmp.upload_object({
                    bucket: upload_bkt,
                    key: upload_key_non_existing,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    md_conditions: {
                        if_match_etag: invalid_etag,
                    },
                }, dummy_object_sdk);

                assert.fail('upload_object should fail');
            } catch (err) {
                assert.strictEqual(err.code, 'ENOENT');
            }
        });

        mocha.it('upload_object with If-Match on disabled content dir', async function() {
            const upload_res_1 = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_directory_key,
                size: 0
            }, dummy_object_sdk);

            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_directory_key,
                size: 0,
                md_conditions: {
                    if_match_etag: upload_res_1.etag,
                },
            }, dummy_object_sdk);

        });

        mocha.it('upload_object with If-None-Match that passes', async function() {
            const invalid_etag = 'non-matching-etag';
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                md_conditions: {
                    if_none_match_etag: invalid_etag,
                },
            }, dummy_object_sdk);
        });

        mocha.it('upload_object with If-None-Match that fails', async function() {
            const upload_res_1 = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);

            try {
                await ns_tmp.upload_object({
                    bucket: upload_bkt,
                    key: upload_key,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    md_conditions: {
                        if_none_match_etag: upload_res_1.etag,
                    },
                }, dummy_object_sdk);

                assert.fail('upload_object should fail');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'IF_NONE_MATCH_ETAG');
            }
        });

        mocha.it('complete_object_upload with If-Match that passes', async function() {
            const upload_res_1 = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);

            const create_res = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: upload_key,
            }, dummy_object_sdk);

            const part_res = await ns_tmp.upload_multipart({
                obj_id: create_res.obj_id,
                bucket: mpu_bkt,
                key: upload_key,
                num: 1,
                source_stream: buffer_utils.buffer_to_read_stream(data),
            }, dummy_object_sdk);

            await ns_tmp.complete_object_upload({
                obj_id: create_res.obj_id,
                bucket: mpu_bkt,
                key: upload_key,
                multiparts: [{ num: 1, etag: part_res.etag }],
                md_conditions: {
                    if_match_etag: upload_res_1.etag,
                },
            }, dummy_object_sdk);
        });

        mocha.it('complete_object_upload with If-Match that fails', async function() {
            const invalid_etag = 'non-matching-etag';

            const create_res = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: upload_key,
            }, dummy_object_sdk);

            const part_res = await ns_tmp.upload_multipart({
                obj_id: create_res.obj_id,
                bucket: mpu_bkt,
                key: upload_key,
                num: 1,
                source_stream: buffer_utils.buffer_to_read_stream(data),
            }, dummy_object_sdk);

            try {
                await ns_tmp.complete_object_upload({
                    obj_id: create_res.obj_id,
                    bucket: mpu_bkt,
                    key: upload_key,
                    multiparts: [{ num: 1, etag: part_res.etag }],
                    md_conditions: {
                        if_match_etag: invalid_etag,
                    },
                }, dummy_object_sdk);

                assert.fail('complete_object_upload should fail');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'IF_MATCH_ETAG');
            }
        });

        mocha.it('complete_object_upload with If-None-Match that passes', async function() {
            const invalid_etag = 'non-matching-etag';

            const create_res = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: upload_key,
            }, dummy_object_sdk);

            const part_res = await ns_tmp.upload_multipart({
                obj_id: create_res.obj_id,
                bucket: mpu_bkt,
                key: upload_key,
                num: 1,
                source_stream: buffer_utils.buffer_to_read_stream(data),
            }, dummy_object_sdk);

            await ns_tmp.complete_object_upload({
                obj_id: create_res.obj_id,
                bucket: mpu_bkt,
                key: upload_key,
                multiparts: [{ num: 1, etag: part_res.etag }],
                md_conditions: {
                    if_none_match_etag: invalid_etag,
                },
            }, dummy_object_sdk);
        });

        mocha.it('complete_object_upload with If-None-Match that fails', async function() {
            const upload_res_1 = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);

            const create_res = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: upload_key,
            }, dummy_object_sdk);

            const part_res = await ns_tmp.upload_multipart({
                obj_id: create_res.obj_id,
                bucket: mpu_bkt,
                key: upload_key,
                num: 1,
                source_stream: buffer_utils.buffer_to_read_stream(data),
            }, dummy_object_sdk);

            try {
                await ns_tmp.complete_object_upload({
                    obj_id: create_res.obj_id,
                    bucket: mpu_bkt,
                    key: upload_key,
                    multiparts: [{ num: 1, etag: part_res.etag }],
                    md_conditions: {
                        if_none_match_etag: upload_res_1.etag,
                    },
                }, dummy_object_sdk);

                assert.fail('complete_object_upload should fail');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'IF_NONE_MATCH_ETAG');
            }
        });
    });

    mocha.describe('content encoding', function() {

        const upload_key = 'upload_key_content_encoding';
        const upload_key_dir = 'upload_key_content_encoding1/';
        const data = crypto.randomBytes(100);

        mocha.it('upload and read object without content encoding', async function() {
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);

            const md = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk);
            assert.strictEqual(md.content_encoding, undefined);
        });

        mocha.it('upload and read object with content encoding', async function() {
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                content_encoding: 'gzip',
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);

            const md = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk);
            assert.strictEqual(md.content_encoding, 'gzip');
        });

        mocha.it('upload and read empty content dir with content encoding', async function() {
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_dir,
                content_encoding: 'gzip',
                size: 0
            }, dummy_object_sdk);

            const md = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: upload_key_dir,
            }, dummy_object_sdk);
            assert.strictEqual(md.content_encoding, 'gzip');
        });
    });

    mocha.describe('restore_object', function() {
        const restore_key = 'restore_key_1';
        const data = crypto.randomBytes(100);

        mocha.before(async function() {
            const dir = await mkdtemp(`${os.tmpdir()}${path.sep}`);
            config.NSFS_GLACIER_LOGS_DIR = dir;
        });

        mocha.describe('GLACIER storage class not supported', function() {
            mocha.before(async function() {
                const upload_res = await ns_tmp.upload_object({
                    bucket: upload_bkt,
                    key: restore_key,
                    source_stream: buffer_utils.buffer_to_read_stream(data)
                }, dummy_object_sdk);

                console.log('upload_object response', inspect(upload_res));
            });

            mocha.it('fails to issue restore-object', async function() {
                try {
                    await ns_tmp.restore_object({
                        bucket: upload_bkt,
                        key: restore_key,
                        days: 1,
                    }, dummy_object_sdk);

                    assert.fail('restore_object should fail');
                } catch (err) {
                    assert.strictEqual(err instanceof S3Error, true);
                    assert.strictEqual(err.code, S3Error.InvalidStorageClass.code);
                    assert.strictEqual(err.message, S3Error.InvalidStorageClass.message);
                    assert.strictEqual(err.http_code, S3Error.InvalidStorageClass.http_code);
                }
            });

            mocha.after(async function() {
                const delete_res = await ns_tmp.delete_object({
                    bucket: upload_bkt,
                    key: restore_key,
                }, dummy_object_sdk);

                console.log('delete_object response', inspect(delete_res));
            });
        });

        mocha.describe('GLACIER storage class supported', function() {
            const temp_restore_key = 'restore_key_1_glacier';

            mocha.before(async function() {
                // Monkey patch the _is_storage_class_supported function to return true
                ns_tmp._is_storage_class_supported = async () => true;

                const upload_res = await ns_tmp.upload_object({
                    bucket: upload_bkt,
                    key: restore_key,
                    source_stream: buffer_utils.buffer_to_read_stream(data)
                }, dummy_object_sdk);

                console.log('upload_object response', inspect(upload_res));
                const upload_res_2 = await ns_tmp.upload_object({
                    bucket: upload_bkt,
                    key: temp_restore_key,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                }, dummy_object_sdk);

                console.log('upload_object response 2', inspect(upload_res_2));
            });

            mocha.it('fails when the uploaded object is not in GLACIER storage class', async function() {
                try {
                    await ns_tmp.restore_object({
                        bucket: upload_bkt,
                        key: restore_key,
                        days: 1,
                    }, dummy_object_sdk);

                    assert.fail('restore_object should fail');
                } catch (err) {
                    assert.strictEqual(err instanceof S3Error, true);
                    assert.strictEqual(err.code, S3Error.InvalidObjectStorageClass.code);
                    assert.strictEqual(err.message, S3Error.InvalidObjectStorageClass.message);
                    assert.strictEqual(err.http_code, S3Error.InvalidObjectStorageClass.http_code);
                }
            });

            mocha.it('succeeds when object is in GLACIER storage class', async function() {
                const restore_res = await ns_tmp.restore_object({
                    bucket: upload_bkt,
                    key: temp_restore_key,
                    days: 1,
                }, dummy_object_sdk);

                console.log('restore_object response', inspect(restore_res));

                const restore_objectmd = await ns_tmp.read_object_md({
                    bucket: upload_bkt,
                    key: temp_restore_key,
                    days: 1,
                }, dummy_object_sdk);

                assert.strictEqual(restore_objectmd.storage_class, s3_utils.STORAGE_CLASS_GLACIER);
                assert.strictEqual(restore_objectmd.restore_status.ongoing, true);
                assert.strictEqual(restore_objectmd.restore_status.expiry_time, undefined);

                // Don't leak the xattrs to the user
                assert.strictEqual(restore_objectmd.xattr['user.noobaa.restore.request'], undefined);
                assert.strictEqual(restore_objectmd.xattr['user.noobaa.restore.expiry'], undefined);

                const xattr = await get_xattr(path.join(ns_tmp_bucket_path, temp_restore_key));
                assert.strictEqual(xattr['user.noobaa.restore.request'], '1');
                assert.strictEqual(xattr['user.noobaa.restore.expiry'], undefined);

                // disallows duplicate restore requests
                try {
                    await ns_tmp.restore_object({
                        bucket: upload_bkt,
                        key: temp_restore_key,
                        days: 1,
                    }, dummy_object_sdk);

                    assert.fail('restore_object should fail');
                } catch (err) {
                    assert.strictEqual(err instanceof S3Error, true);
                    assert.strictEqual(err.code, S3Error.RestoreAlreadyInProgress.code);
                    assert.strictEqual(err.message, S3Error.RestoreAlreadyInProgress.message);
                    assert.strictEqual(err.http_code, S3Error.RestoreAlreadyInProgress.http_code);
                }
            });


            mocha.after(async function() {
                const delete_res = await ns_tmp.delete_object({
                    bucket: upload_bkt,
                    key: restore_key,
                }, dummy_object_sdk);
                console.log('delete_object response', inspect(delete_res));

                const delete_res_2 = await ns_tmp.delete_object({
                        bucket: upload_bkt,
                        key: temp_restore_key,
                }, dummy_object_sdk);
                console.log('delete_object response 2', inspect(delete_res_2));

                // Restore the _is_storage_class_supported function
                ns_tmp._is_storage_class_supported = NamespaceFS.prototype._is_storage_class_supported;
            });
        });
    });
});

const add_user_prefix = user_xattr => _.mapKeys(user_xattr, (val, key) => 'user.' + key);


mocha.describe('namespace_fs folders tests', function() {
    const src_bkt = 'src';
    const upload_bkt = 'test_ns_uploads_object';
    const mpu_bkt = 'test_ns_multipart_upload';
    const md = { key1: 'val1', key2: 'val2' };
    const md1 = { key123: 'val123', key234: 'val234' };
    const user_md = _.mapKeys(md, (val, key) => 'user.' + key);
    const user_md1 = _.mapKeys(md1, (val, key) => 'user.' + key);
    const dir_content_md = { [XATTR_DIR_CONTENT]: 'true' };
    const user_md_and_dir_content_xattr = { ...user_md, ...dir_content_md };
    const user_md1_and_dir_content_xattr = { ...user_md1, ...dir_content_md };
    let not_user_xattr = {};
    const tmp_fs_path = path.join(TMP_PATH, 'test_namespace_fs');
    if (os_utils.IS_MAC) {
        not_user_xattr = { 'not_user_xattr1': 'not1', 'not_user_xattr2': 'not2' };
    }
    const dummy_object_sdk = make_dummy_object_sdk(tmp_fs_path);

    const ns_tmp_bucket_path = `${tmp_fs_path}/${src_bkt}`;
    const ns_tmp = new NamespaceFS({ bucket_path: ns_tmp_bucket_path, bucket_id: '2', namespace_resource_id: undefined });

    mocha.before(async () => {
        await P.all(_.map([src_bkt, upload_bkt, mpu_bkt], async buck =>
            fs_utils.create_fresh_path(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => {
        await P.all(_.map([src_bkt, upload_bkt, mpu_bkt], async buck =>
            fs_utils.folder_delete(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_path));

    mocha.describe('folders xattr', function() {
        const dir_1 = 'a/b/c/';
        const upload_key_1 = dir_1 + 'upload_key_1/';
        const upload_key_2 = 'my_dir/';
        //const upload_key_2_copy = 'my_copy_dir/';
        const upload_key_3 = 'my_dir_0_content/';
        const upload_key_4 = 'my_dir2/';
        const upload_key_5 = 'my_dir_mpu1/';
        const upload_key_6 = 'my_dir_mpu2/';
        const upload_key_4_full = path.join(upload_key_2, upload_key_4);
        const obj_sizes_map = {
            [upload_key_1]: 100,
            [upload_key_2]: 100,
            [upload_key_3]: 0,
            [upload_key_4_full]: 100
        };
        const mpu_keys_and_size_map = {
            [upload_key_5]: 100,
            [upload_key_6]: 0
        };
        const a = 'a/';
        const data = crypto.randomBytes(100);

        mocha.before(async function() {
            const stream1 = buffer_utils.buffer_to_read_stream(data);
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_1,
                xattr: md,
                source_stream: stream1,
                size: obj_sizes_map[upload_key_1]
            }, dummy_object_sdk);
            const full_xattr = await get_xattr(ns_tmp_bucket_path + '/' + upload_key_1);
            assert.equal(Object.keys(full_xattr).length, 3);
            assert.deepEqual(full_xattr, {
                ...user_md_and_dir_content_xattr,
                [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_1]
            });

            // a/ should not have dir_content xattr since it's not an object
            const full_xattr1 = await get_xattr(ns_tmp_bucket_path + '/a/');
            assert.equal(Object.keys(full_xattr1).length, 0);
            assert.deepEqual(full_xattr1, {});
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_2,
                xattr: md,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                size: obj_sizes_map[upload_key_2]
            }, dummy_object_sdk);
            const full_xattr2 = await get_xattr(ns_tmp_bucket_path + '/' + upload_key_2);
            assert.equal(Object.keys(full_xattr2).length, 3);
            assert.deepEqual(full_xattr2, {
                ...user_md_and_dir_content_xattr,
                [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_2]
            });

            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_3,
                xattr: md,
                source_stream: buffer_utils.buffer_to_read_stream(undefined),
                size: obj_sizes_map[upload_key_3]
            }, dummy_object_sdk);
            const full_xattr3 = await get_xattr(ns_tmp_bucket_path + '/' + upload_key_3);
            assert.equal(Object.keys(full_xattr3).length, 3);
            assert.deepEqual(full_xattr3, {
                ...user_md_and_dir_content_xattr,
                [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_3]
            });

            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_4_full,
                xattr: md,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                size: obj_sizes_map[upload_key_4_full]
            }, dummy_object_sdk);
            const full_xattr4 = await get_xattr(ns_tmp_bucket_path + '/' + upload_key_4_full);
            assert.equal(Object.keys(full_xattr4).length, 3);
            assert.deepEqual(full_xattr4, {
                ...user_md_and_dir_content_xattr,
                [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_4_full]
            });
            await P.all(Object.keys(mpu_keys_and_size_map).map(async key => {
                const mpu_upload_id1 = await ns_tmp.create_object_upload({
                    bucket: upload_bkt,
                    key: key,
                    xattr: mpu_keys_and_size_map[key] > 0 ? md : undefined,
                }, dummy_object_sdk);

                const put_part_res = await ns_tmp.upload_multipart({
                    bucket: upload_bkt,
                    key: key,
                    num: 1,
                    source_stream: buffer_utils.buffer_to_read_stream(mpu_keys_and_size_map[key] > 0 ? data : undefined),
                    size: mpu_keys_and_size_map[key],
                    obj_id: mpu_upload_id1.obj_id
                }, dummy_object_sdk);

                await ns_tmp.complete_object_upload({
                    bucket: upload_bkt,
                    key: key,
                    obj_id: mpu_upload_id1.obj_id,
                    multiparts: [{ num: 1, etag: put_part_res.etag }]
                }, dummy_object_sdk);
                const p = path.join(ns_tmp_bucket_path, key);
                const p1 = path.join(ns_tmp_bucket_path, key, config.NSFS_FOLDER_OBJECT_NAME);

                const full_xattr_mpu = await get_xattr(p);
                if (mpu_keys_and_size_map[key] > 0) {
                    assert.equal(Object.keys(full_xattr_mpu).length, 3);
                    assert.deepEqual(full_xattr_mpu, { ...user_md_and_dir_content_xattr, [XATTR_DIR_CONTENT]: mpu_keys_and_size_map[key] });
                    await fs_utils.file_must_exist(p1);
                } else {
                    assert.equal(Object.keys(full_xattr_mpu).length, 1);
                    assert.deepEqual(full_xattr_mpu, { ...dir_content_md, [XATTR_DIR_CONTENT]: mpu_keys_and_size_map[key] });
                    await fs_utils.file_must_exist(p1); // On mpu we always create DIR_CONTENT_FILE, even if its size is 0
                }
            }));
        });

        mocha.it(`read folder object md - key doesn't end with /`, async function() {
            try {
                await ns_tmp.read_object_md({
                    bucket: upload_bkt,
                    key: upload_key_1.slice(0, upload_key_1.length - 1),
                }, dummy_object_sdk);
                assert.fail('should have failed with ENOENT');
            } catch (err) {
                assert.equal(err.code, 'ENOENT');
                assert.equal(err.rpc_code, 'NO_SUCH_OBJECT');
            }
        });

        mocha.it(`read folder object md full md`, async function() {
            const get_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: upload_key_1,
            }, dummy_object_sdk);
            assert.equal(Object.keys(get_md_res.xattr).length, 2);
            assert.deepEqual(get_md_res.xattr, md);
            const full_xattr = await get_xattr(ns_tmp_bucket_path + '/' + upload_key_1);
            assert.equal(Object.keys(full_xattr).length, 3);
            assert.deepEqual(full_xattr, {
                ...user_md_and_dir_content_xattr,
                [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_1]
            });
        });
        // check copy works for dirs on master
        // mocha.it(`copy object & read folder object md full md`, async function() {
        //     const upload_res2 = await ns_tmp.upload_object({
        //         bucket: upload_bkt,
        //         key: upload_key_2_copy,
        //         copy_source: { key: upload_key_2 }
        //     }, dummy_object_sdk);
        //     console.log('copy object with trailing / response', inspect(upload_res2));

        //     const get_md_res = await ns_tmp.read_object_md({
        //         bucket: upload_bkt,
        //         key: upload_key_2_copy,
        //     }, dummy_object_sdk);
        //     console.log('copy object read folder object md ', inspect(get_md_res));

        //     const full_xattr2 = await get_xattr(DEFAULT_FS_CONFIG, path.join(ns_tmp_bucket_path, upload_key_2_copy));
        //     console.log('copy object full xattr ', inspect(full_xattr2));
        //     assert.equal(Object.keys(full_xattr2).length, 3);
        //     assert.deepEqual(full_xattr2, user_md_and_dir_content_xattr);

        //     const p = path.join(ns_tmp_bucket_path, upload_key_2_copy, config.NSFS_FOLDER_OBJECT_NAME);
        //     await fs_utils.file_must_exist(p);
        // });

        mocha.it(`override object & read folder object md full md`, async function() {
            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key_2,
            }, dummy_object_sdk, read_res);
            assert.equal(read_res.buffers.length, 1);
            assert.equal(read_res.total_length, 100);
            if (Object.keys(not_user_xattr).length) await set_xattr(DEFAULT_FS_CONFIG, ns_tmp_bucket_path + '/' + upload_key_2, not_user_xattr);

            const new_size = 0;
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_2,
                xattr: md1,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                size: new_size
            }, dummy_object_sdk);

            const get_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: upload_key_2,
            }, dummy_object_sdk);
            assert.ok(Object.keys(md1).every(md_cur => get_md_res.xattr[md_cur] !== undefined));
            const full_xattr2 = await get_xattr(ns_tmp_bucket_path + '/' + upload_key_2);
            assert.deepEqual(full_xattr2, { ...user_md1_and_dir_content_xattr, [XATTR_DIR_CONTENT]: new_size, ...not_user_xattr });


            const read_res1 = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key_2,
            }, dummy_object_sdk, read_res1);
            assert.equal(read_res1.buffers.length, 0);
            assert.equal(read_res1.total_length, 0);
        });

        mocha.it(`read folder object md full md`, async function() {
            const get_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: upload_key_3,
            }, dummy_object_sdk);
            assert.equal(Object.keys(get_md_res.xattr).length, 2);
            assert.deepEqual(get_md_res.xattr, md);
            const full_xattr = await get_xattr(ns_tmp_bucket_path + '/' + upload_key_3);
            assert.equal(Object.keys(full_xattr).length, 3);
            assert.deepEqual(full_xattr, { ...user_md_and_dir_content_xattr, [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_3] });

        });

        mocha.it(`.folder of dir object of content of size > 0 - should exist`, async function() {
            const p = path.join(ns_tmp_bucket_path, upload_key_1, config.NSFS_FOLDER_OBJECT_NAME);
            await fs_utils.file_must_exist(p);
        });

        mocha.it(`read folder object - 0 content - should return empty file`, async function() {
            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key_3,
            }, dummy_object_sdk, read_res);
            assert.equal(read_res.buffers.length, 0);
            assert.equal(read_res.total_length, 0);
        });

        mocha.it(`.folder of dir object of content of size 0 - should not exist`, async function() {
            const p = path.join(ns_tmp_bucket_path, upload_key_3, config.NSFS_FOLDER_OBJECT_NAME);
            await fs_utils.file_must_not_exist(p);
        });


        mocha.it(`read folder object > 0 content - should return size 100`, async function() {
            const res = await ns_tmp.list_objects({
                bucket: upload_bkt,
                prefix: upload_key_1
            }, dummy_object_sdk);
            assert.equal(res.objects.find(obj => obj.key === upload_key_1).size, 100);
        });

        mocha.it(`read folder object = 0 content - should return size 0`, async function() {
            const res = await ns_tmp.list_objects({
                bucket: upload_bkt,
                prefix: upload_key_3
            }, dummy_object_sdk);
            assert.equal(res.objects.find(obj => obj.key === upload_key_3).size, 0);
        });

        mocha.it(`read folder object > 0 content - should return data`, async function() {
            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key_1,
            }, dummy_object_sdk, read_res);
            assert.equal(read_res.buffers.length, 1);
            assert.equal(read_res.total_length, 100);
        });

        mocha.it(`.folder of non directory object - should not exist`, async function() {
            const p = path.join(ns_tmp_bucket_path, a, config.NSFS_FOLDER_OBJECT_NAME);
            await fs_utils.file_must_not_exist(p);
        });

        mocha.it(`get folder object md - should fail, not a directory object`, async function() {
            try {
                await ns_tmp.read_object_md({
                    bucket: upload_bkt,
                    key: dir_1,
                }, dummy_object_sdk);
                assert.fail('get object should have failed with no such key');
            } catch (err) {
                assert.equal(err.code, 'ENOENT');
            }
        });

        mocha.it(`read folder object md missing md`, async function() {
            const dir_path = ns_tmp_bucket_path + '/' + upload_key_1;
            const get_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: upload_key_1,
            }, dummy_object_sdk);
            assert.deepEqual(get_md_res.xattr, md);
            const full_xattr = await get_xattr(dir_path);
            assert.deepEqual(full_xattr, { ...user_md_and_dir_content_xattr, [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_1] });
        });

        mocha.it(`put /a/b/c folder object md exists`, async function() {
            const dir_path = ns_tmp_bucket_path + '/' + dir_1;
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: dir_1,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                size: 0
            }, dummy_object_sdk);
            const full_xattr2 = await get_xattr(dir_path);
            assert.equal(Object.keys(full_xattr2).length, 1);
            assert.ok(full_xattr2[XATTR_DIR_CONTENT] !== undefined && full_xattr2[XATTR_DIR_CONTENT] === '0');

            const get_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: dir_1,
            }, dummy_object_sdk);
            assert.equal(Object.keys(get_md_res.xattr).length, 0);
            await fs_utils.file_must_not_exist(path.join(dir_path, config.NSFS_FOLDER_OBJECT_NAME));

        });

        mocha.it(`list objects md with delimiter`, async function() {
            const ls_obj_res = await ns_tmp.list_objects({
                bucket: upload_bkt,
                delimiter: '/',
            }, dummy_object_sdk);
            assert.deepEqual(ls_obj_res.common_prefixes, [a, upload_key_2, upload_key_3, upload_key_5, upload_key_6]);
        });

        mocha.it(`list objects md with delimiter & prefix`, async function() {
            const ls_obj_res = await ns_tmp.list_objects({
                bucket: upload_bkt,
                delimiter: '/',
                prefix: upload_key_2
            }, dummy_object_sdk);
            assert.deepEqual(ls_obj_res.common_prefixes, [upload_key_2 + upload_key_4]);
            assert.deepEqual(ls_obj_res.objects.map(obj => obj.key), [upload_key_2]);

        });

        mocha.it(`list objects md`, async function() {
            const ls_obj_res = await ns_tmp.list_objects({ bucket: upload_bkt, }, dummy_object_sdk);
            console.log('list objects md 1 ', inspect(ls_obj_res));
            assert.deepEqual(ls_obj_res.common_prefixes, []);
            assert.deepEqual(ls_obj_res.objects.map(obj => obj.key),
                [dir_1, upload_key_1, upload_key_2, upload_key_4_full, upload_key_3, upload_key_5, upload_key_6]);
        });

        mocha.it(`list objects md key marker 1 - dir content`, async function() {
            const ls_obj_res = await ns_tmp.list_objects({ bucket: upload_bkt, key_marker: dir_1 }, dummy_object_sdk);
            console.log('list objects md key marker 1', inspect(ls_obj_res));
            assert.deepEqual(ls_obj_res.objects.map(obj => obj.key),
                [upload_key_1, upload_key_2, upload_key_4_full, upload_key_3, upload_key_5, upload_key_6]);
            assert.deepEqual(ls_obj_res.common_prefixes, []);
        });

        mocha.it(`list objects md key marker 2`, async function() {
            const ls_obj_res = await ns_tmp.list_objects({ bucket: upload_bkt, key_marker: 'a/b/c' }, dummy_object_sdk);
            console.log('list objects md key marker 2', inspect(ls_obj_res));
            assert.deepEqual(ls_obj_res.objects.map(obj => obj.key),
                [dir_1, upload_key_1, upload_key_2, upload_key_4_full, upload_key_3, upload_key_5, upload_key_6]);
            assert.deepEqual(ls_obj_res.common_prefixes, []);
        });

        mocha.it(`list objects md prefix 1`, async function() {
            const ls_obj_res = await ns_tmp.list_objects({ bucket: upload_bkt, prefix: dir_1, delimiter: '/' }, dummy_object_sdk);
            console.log('list objects md prefix 1', inspect(ls_obj_res));
            assert.deepEqual(ls_obj_res.objects.map(obj => obj.key), [dir_1]);
            assert.deepEqual(ls_obj_res.common_prefixes, [upload_key_1]);
        });

        mocha.it(`list objects md prefix 2`, async function() {
            const ls_obj_res = await ns_tmp.list_objects({ bucket: upload_bkt, prefix: 'a/b/c', delimiter: '/' }, dummy_object_sdk);
            console.log('list objects md prefix 2', inspect(ls_obj_res));
            assert.deepEqual(ls_obj_res.objects.map(obj => obj.key), []);
            assert.deepEqual(ls_obj_res.common_prefixes, [dir_1]);
        });

        mocha.it(`list objects md prefix 3 - not an object`, async function() {
            const ls_obj_res = await ns_tmp.list_objects({ bucket: upload_bkt, prefix: 'a/b/', delimiter: '/' }, dummy_object_sdk);
            console.log('list objects md prefix 3', inspect(ls_obj_res));
            assert.deepEqual(ls_obj_res.objects.map(obj => obj.key), []);
            assert.deepEqual(ls_obj_res.common_prefixes, [dir_1]);
        });

        mocha.it(`list objects md prefix 4`, async function() {
            const ls_obj_res = await ns_tmp.list_objects({ bucket: upload_bkt, prefix: 'a/b', delimiter: '/' }, dummy_object_sdk);
            console.log('list objects md prefix 4', inspect(ls_obj_res));
            assert.deepEqual(ls_obj_res.objects.map(obj => obj.key), []);
            assert.deepEqual(ls_obj_res.common_prefixes, ['a/b/']);
        });

        mocha.it('delete inner directory object /my-dir when exists /my-dir/my-dir2', async function() {
            await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_2,
            }, dummy_object_sdk);

            const p1 = path.join(ns_tmp_bucket_path, upload_key_2);
            await fs_utils.file_must_not_exist(path.join(p1, config.NSFS_FOLDER_OBJECT_NAME));
            const p2 = path.join(ns_tmp_bucket_path, upload_key_2, upload_key_4);
            await fs_utils.file_must_exist(path.join(p2, config.NSFS_FOLDER_OBJECT_NAME));

            const full_xattr1 = await get_xattr(p1);
            assert.deepEqual(full_xattr1, { ...not_user_xattr });

            const full_xattr2 = await get_xattr(p2);
            assert.deepEqual(full_xattr2, { ...user_md_and_dir_content_xattr, [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_2] });

        });

        mocha.it('delete inner object in directory object size 0 - no .folder file but directory still exists', async function() {
            const inner_key = '/inner_obj';
            const key = upload_key_3 + inner_key;
            const source = buffer_utils.buffer_to_read_stream(data);
            await upload_object(ns_tmp, upload_bkt, key, dummy_object_sdk, source);
            const p1 = path.join(ns_tmp_bucket_path, upload_key_3);
            const p2 = path.join(ns_tmp_bucket_path, key);
            await fs_utils.file_must_not_exist(path.join(p1, config.NSFS_FOLDER_OBJECT_NAME));
            const full_xattr1 = await get_xattr(p1);
            assert.deepEqual(full_xattr1, { ...user_md_and_dir_content_xattr, [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_3] });
            await ns_tmp.delete_object({ bucket: upload_bkt, key: key }, dummy_object_sdk);
            await fs_utils.file_must_exist(p1);
            await fs_utils.file_must_not_exist(p2);
        });

        mocha.it('delete inner directory object size > 0 in directory object size 0 - no .folder file but directory still exists', async function() {
            const inner_dir_obj_key = '/inner_dir_obj_key';
            const key = upload_key_3 + inner_dir_obj_key;
            const source = buffer_utils.buffer_to_read_stream(data);
            await upload_object(ns_tmp, upload_bkt, key, dummy_object_sdk, source);
            const p1 = path.join(ns_tmp_bucket_path, upload_key_3);
            const p2 = path.join(ns_tmp_bucket_path, key);
            await fs_utils.file_must_not_exist(path.join(p1, config.NSFS_FOLDER_OBJECT_NAME));
            const full_xattr1 = await get_xattr(p1);
            assert.deepEqual(full_xattr1, { ...user_md_and_dir_content_xattr, [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_3] });
            await ns_tmp.delete_object({ bucket: upload_bkt, key: key }, dummy_object_sdk);
            await fs_utils.file_must_exist(p1);
            await fs_utils.file_must_not_exist(p2);
        });

        mocha.it('delete object content 0 - no .folder file', async function() {
            const p1 = path.join(ns_tmp_bucket_path, upload_key_3);
            const full_xattr1 = await get_xattr(p1);
            assert.deepEqual(full_xattr1, { ...user_md_and_dir_content_xattr, [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_3] });
            await ns_tmp.delete_object({ bucket: upload_bkt, key: upload_key_3, }, dummy_object_sdk);
            await fs_utils.file_must_not_exist(path.join(p1, config.NSFS_FOLDER_OBJECT_NAME));
            await fs_utils.file_must_not_exist(p1);
        });

        mocha.it('delete multiple objects /my-dir/my-dir2', async function() {
            const p1 = path.join(ns_tmp_bucket_path, upload_key_2);
            const p2 = path.join(p1, upload_key_4);
            const full_xattr1 = await get_xattr(p2);
            assert.deepEqual(full_xattr1, { ...user_md_and_dir_content_xattr, [XATTR_DIR_CONTENT]: obj_sizes_map[upload_key_4_full] });
            await ns_tmp.delete_multiple_objects({
                bucket: upload_bkt,
                objects: [upload_key_2 + upload_key_4, upload_key_2].map(key => ({ key })),
            }, dummy_object_sdk);
            await fs_utils.file_must_not_exist(path.join(p2, config.NSFS_FOLDER_OBJECT_NAME));
            await fs_utils.file_must_not_exist(p2);
            await fs_utils.file_must_not_exist(p1);

        });
        mocha.it('delete multiple objects - a/b/c/', async function() {
            const p1 = path.join(ns_tmp_bucket_path, dir_1);
            await ns_tmp.delete_multiple_objects({
                bucket: upload_bkt,
                objects: [dir_1].map(key => ({ key })),
            }, dummy_object_sdk);
            await fs_utils.file_must_exist(p1);
            await fs_utils.file_must_not_exist(path.join(p1, config.NSFS_FOLDER_OBJECT_NAME));
            const full_xattr1 = await get_xattr(p1);
            assert.deepEqual(full_xattr1, {});
        });
    });
});

// need to check how it behaves on master
// mocha.it('delete object', async function() {
//     const delete_res = await ns_tmp.delete_object({
//         bucket: upload_bkt,
//         key: 'my_dir',
//     }, dummy_object_sdk);
//     console.log('delete_object with trailing / (key 2) response', inspect(delete_res));
// });


async function get_xattr(file_path) {
    const stat = await nb_native().fs.stat(DEFAULT_FS_CONFIG, file_path);
    return stat.xattr;
}

async function set_xattr(fs_account_config, file_path, fs_xattr) {
    let file;
    try {
        file = await nb_native().fs.open(fs_account_config, file_path, undefined, get_umasked_mode(config.BASE_MODE_FILE));
        const full_xattr = await file.replacexattr(DEFAULT_FS_CONFIG, fs_xattr);
        return full_xattr;
    } catch (err) {
        console.log('ERROR: test_namespace_fs set_xattr', err);
        throw err;
    } finally {
        file.close(DEFAULT_FS_CONFIG, file_path);
    }
}


function get_umasked_mode(mode) {
    // eslint-disable-next-line no-bitwise
    return mode & ~config.NSFS_UMASK;
}
mocha.describe('nsfs_symlinks_validations', function() {

    const tmp_fs_path = path.join(TMP_PATH, 'test_nsfs_symboliclinks');
    const bucket = 'bucket1';
    const bucket_full_path = tmp_fs_path + '/' + bucket;
    const expected_dirs = ['d1', 'd2', 'd3/d3d1'];
    const expected_files = ['f1', 'f2', 'f3', 'd2/f4', 'd2/f5', 'd3/d3d1/f6'];
    const expected_links = [{ t: 'f1', n: 'lf1' }, { t: '/etc', n: 'ld2' }];
    const dummy_object_sdk = make_dummy_object_sdk(tmp_fs_path);
    const ns = new NamespaceFS({ bucket_path: bucket_full_path, bucket_id: '1', namespace_resource_id: undefined });

    mocha.before(async () => {
        await fs_utils.create_fresh_path(`${bucket_full_path}`);
        await P.all(_.map(expected_dirs, async dir =>
            fs_utils.create_fresh_path(`${bucket_full_path}/${dir}`)));
        await P.all(_.map(expected_files, async file =>
            create_file(`${bucket_full_path}/${file}`)));
        await P.all(_.map(expected_links, async link =>
            fs.promises.symlink(link.t, `${bucket_full_path}/${link.n}`)));

    });

    mocha.after(async () => {
        await P.all(_.map(expected_files, async file =>
            fs_utils.folder_delete(`${bucket_full_path}/${file}`)));
    });
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_path));

    mocha.describe('without_symlinks', function() {
        mocha.it('without_symlinks:list iner dir', async function() {
            const res = await list_objects(ns, bucket, '/', 'd2/', dummy_object_sdk);
            assert.strictEqual(res.objects.length, 2, 'amount of files is not as expected');
        });

        mocha.it('without_symlinks:list iner dir without delimiter', async function() {
            const res = await list_objects(ns, bucket, undefined, 'd2/', dummy_object_sdk);
            assert.strictEqual(res.objects.length, 2, 'amount of files is not as expected');
        });

        mocha.it('without_symlinks:read_object_md', async function() {
            try {
                await read_object_md(ns, bucket, 'd2/f4', dummy_object_sdk);
            } catch (err) {
                assert(err, 'read_object_md failed with err');
            }
        });

        mocha.it('without_symlinks:read_object_stream', async function() {
            try {
                await read_object_stream(ns, bucket, 'd2/f4', dummy_object_sdk);
            } catch (err) {
                assert(err, 'read_object_stream failed with err');
            }
        });

        mocha.it('without_symlinks:upload_object', async function() {
            const data = crypto.randomBytes(100);
            const source = buffer_utils.buffer_to_read_stream(data);
            try {
                await upload_object(ns, bucket, 'd2/uploaded-file1', dummy_object_sdk, source);
            } catch (err) {
                assert(err, 'upload_object failed with err');
            }
        });

        mocha.it('without_symlinks:delete_object', async function() {
            try {
                await delete_object(ns, bucket, 'd2/uploaded-file1', dummy_object_sdk);
            } catch (err) {
                assert(err, 'delete_object failed with err');
            }
        });
    });

    mocha.describe('by_symlinks', function() {
        mocha.it('by_symlinks:list root dir', async function() {
            const res = await list_objects(ns, bucket, '/', undefined, dummy_object_sdk);
            assert.strictEqual(res.objects.length, 4, 'amount of files is not as expected');
        });

        mocha.it('by_symlinks:list src dir without delimiter', async function() {
            const res = await list_objects(ns, bucket, undefined, undefined, dummy_object_sdk);
            console.log("IGOR", res.objects);
            assert.strictEqual(res.objects.length, 7, 'amount of files is not as expected');
        });

        mocha.it('by_symlinks:list iner dir', async function() {
            const res = await list_objects(ns, bucket, '/', 'ld2/', dummy_object_sdk);
            assert.strictEqual(res.objects.length, 0, 'amount of files is not as expected');
        });

        mocha.it('by_symlinks:list iner dir without delimiter', async function() {
            const res = await list_objects(ns, bucket, undefined, 'ld2/', dummy_object_sdk);
            assert.strictEqual(res.objects.length, 0, 'amount of files is not as expected');
        });

        mocha.it('by_symlinks:read_object_md', async function() {
            try {
                await read_object_md(ns, bucket, 'd2/f4', dummy_object_sdk);
            } catch (err) {
                assert.strictEqual(err.code, 'EACCES', 'read_object_md should return access denied');
            }
        });

        mocha.it('by_symlinks:read_object_stream', async function() {
            try {
                await read_object_stream(ns, bucket, 'ld2/f4', dummy_object_sdk);
            } catch (err) {
                assert.strictEqual(err.code, 'EACCES', 'read_object_stream should return access denied');
            }
        });

        mocha.it('by_symlinks:upload_object', async function() {
            const data = crypto.randomBytes(100);
            const source = buffer_utils.buffer_to_read_stream(data);
            try {
                await upload_object(ns, bucket, 'ld2/uploaded-file1', dummy_object_sdk, source);
            } catch (err) {
                assert.strictEqual(err.code, 'EACCES', 'upload_object should return access denied');
            }
        });

        mocha.it('by_symlinks:delete_object', async function() {
            try {
                await delete_object(ns, bucket, 'ld2/f5', dummy_object_sdk);
            } catch (err) {
                assert.strictEqual(err.code, 'EACCES', 'delete_object should return access denied');
            }
        });
    });


});

mocha.describe('namespace_fs copy object', function() {

    const src_bkt = 'src';
    const upload_bkt = 'test_ns_uploads_object';
    const tmp_fs_path = path.join(TMP_PATH, 'test_namespace_fs');
    const md1 = { key123: 'val123', key234: 'val234' };

    const dummy_object_sdk = make_dummy_object_sdk(tmp_fs_path);
    const ns_tmp_bucket_path = `${tmp_fs_path}/${src_bkt}`;
    const ns_tmp = new NamespaceFS({ bucket_path: ns_tmp_bucket_path, bucket_id: '3', namespace_resource_id: undefined });

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
        const copy_xattr = {};
        const copy_key_1 = 'copy_key_1';
        const data = crypto.randomBytes(100);

        mocha.before(async function() {
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            // This is needed for the copy to work because we have a dummy_object_sdk that does not populate
            copy_xattr[XATTR_MD5_KEY] = upload_res.etag;
            console.log('upload_object response', inspect(upload_res));
        });

        mocha.it('copy, read of a small object copy - link flow', async function() {
            const params = {
                bucket: upload_bkt,
                key: copy_key_1,
                xattr: copy_xattr,
                copy_source: { key: upload_key }
            };
            const copy_res = await ns_tmp.upload_object(params, dummy_object_sdk);
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
            const params = {
                bucket: upload_bkt,
                key: copy_key_1,
                xattr: copy_xattr,
                copy_source: {
                    key: upload_key,
                }
            };
            let copy_res = await ns_tmp.upload_object(params, dummy_object_sdk);
            console.log('upload_object: copy twice (1) to the same file name response', inspect(copy_res));

            copy_res = await ns_tmp.upload_object(params, dummy_object_sdk);
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


        mocha.it(`copy directory object to same dir - size 100`, async function() {
            const key = 'dir_to_copy_to_itself0/';
            const res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: key,
                xattr: md1,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                size: 100
            }, dummy_object_sdk);
            const file_path = ns_tmp_bucket_path + '/' + key;
            let xattr = await get_xattr(file_path);
            let read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: key
            }, dummy_object_sdk);
            assert.equal(stream_content_type, read_md_res.content_type);
            assert.equal(res.etag, read_md_res.etag);
            assert.deepStrictEqual(xattr, { ...add_user_prefix(read_md_res.xattr), [XATTR_DIR_CONTENT]: `${read_md_res.size}` });
            md1[s3_utils.XATTR_SORT_SYMBOL] = true;
            assert.deepStrictEqual(md1, read_md_res.xattr);

            const new_content_type = 'application/x-directory1';
            const copy_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key,
                copy_source: { bucket: upload_bkt, key},
                size: 100,
                content_type: new_content_type,
                xattr_copy: true
            }, dummy_object_sdk);
            xattr = await get_xattr(file_path);
            read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: key
            }, dummy_object_sdk);
            assert.equal(new_content_type, read_md_res.content_type);
            assert.equal(copy_res.etag, read_md_res.etag);
            assert.deepStrictEqual(md1, read_md_res.xattr);
            assert.deepStrictEqual(xattr, {
                ...add_user_prefix(read_md_res.xattr),
                [XATTR_DIR_CONTENT]: `${read_md_res.size}`,
                [XATTR_CONTENT_TYPE]: new_content_type
            });
        });

        mocha.it(`override directory object - size 100 -> size 0`, async function() {
            const key = 'dir_to_override0/';
            let res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: key,
                xattr: md1,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                size: 100
            }, dummy_object_sdk);
            const file_path = ns_tmp_bucket_path + '/' + key;
            let xattr = await get_xattr(file_path);
            let read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: key
            }, dummy_object_sdk);
            assert.equal(stream_content_type, read_md_res.content_type);
            assert.equal(res.etag, read_md_res.etag);
            assert.deepStrictEqual(xattr, { ...add_user_prefix(read_md_res.xattr), [XATTR_DIR_CONTENT]: `${read_md_res.size}` });
            md1[s3_utils.XATTR_SORT_SYMBOL] = true;
            assert.deepStrictEqual(md1, read_md_res.xattr);

            res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key,
                source_stream: empty_stream(),
                size: 0,
            }, dummy_object_sdk);
            xattr = await get_xattr(file_path);
            read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: key
            }, dummy_object_sdk);
            assert.equal(read_md_res.size, 0);
            assert.equal(dir_content_type, read_md_res.content_type);
            assert.equal(res.etag, read_md_res.etag);
            assert.deepStrictEqual(0, Object.keys(read_md_res.xattr).length);
            assert.deepStrictEqual(xattr, {
                ...add_user_prefix(read_md_res.xattr),
                [XATTR_DIR_CONTENT]: `${read_md_res.size}`
            });
        });


        mocha.it(`copy directory object to same dir - size 0`, async function() {
            const key = 'dir_to_copy_to_itself1/';
            const new_content_type = 'application/x-directory2';

            const res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: key,
                xattr: md1,
                source_stream: empty_stream(),
                size: 0
            }, dummy_object_sdk);
            const file_path = ns_tmp_bucket_path + '/' + key;
            let xattr = await get_xattr(file_path);
            let read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: key
            }, dummy_object_sdk);
            assert.equal(dir_content_type, read_md_res.content_type);
            assert.equal(res.etag, read_md_res.etag);
            assert.deepStrictEqual(xattr, { ...add_user_prefix(read_md_res.xattr), [XATTR_DIR_CONTENT]: `${read_md_res.size}` });
            md1[s3_utils.XATTR_SORT_SYMBOL] = true;
            assert.deepStrictEqual(md1, read_md_res.xattr);

            const copy_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key,
                copy_source: { bucket: upload_bkt, key},
                size: 0,
                xattr: { k1: 'v1', k2: 'v2', k3: 'v3' },
                content_type: new_content_type,
            }, dummy_object_sdk);
            xattr = await get_xattr(file_path);
            read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key
            }, dummy_object_sdk);
            assert.equal(new_content_type, read_md_res.content_type);
            assert.equal(copy_res.etag, read_md_res.etag);
            assert.deepStrictEqual(xattr, {
                ...add_user_prefix(read_md_res.xattr),
                [XATTR_DIR_CONTENT]: `${read_md_res.size}`,
                [XATTR_CONTENT_TYPE]: new_content_type
            });
        });

        mocha.it(`copy directory object to another dir`, async function() {
            const key1 = 'dir_to_copy_to_itself2/';
            const key2 = 'dir_to_copy_to_itself3/';

            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: key1,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                size: 100,
                xattr: md1
            }, dummy_object_sdk);
            const file_path1 = ns_tmp_bucket_path + '/' + key1;
            let xattr = await get_xattr(file_path1);
            let read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: key1
            }, dummy_object_sdk);
            assert.deepStrictEqual(md1, read_md_res.xattr);
            assert.deepStrictEqual(xattr, { ...add_user_prefix(read_md_res.xattr), [XATTR_DIR_CONTENT]: `${read_md_res.size}` });
            assert.equal(stream_content_type, read_md_res.content_type);

            const copy_source = { bucket: upload_bkt, key: key1 };
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: key2,
                copy_source: copy_source,
                size: 100,
                xattr_copy: true,
                xattr: await _get_source_copy_xattr(copy_source, ns_tmp, dummy_object_sdk)
            }, dummy_object_sdk);
            const file_path2 = ns_tmp_bucket_path + '/' + key2;
            xattr = await get_xattr(file_path2);
            read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: key2
            }, dummy_object_sdk);
            assert.deepStrictEqual(xattr, { ...add_user_prefix(read_md_res.xattr), [XATTR_DIR_CONTENT]: `${read_md_res.size}` });
            assert.deepStrictEqual(md1, read_md_res.xattr);
            assert.equal(stream_content_type, read_md_res.content_type);

        });

        mocha.it(`copy object to a directory dir - size 100`, async function() {
            const src_key = 'obj_to_copy1';
            const dst_key = 'dir_obj_dst1/';

            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: src_key,
                source_stream: buffer_utils.buffer_to_read_stream(data),
                size: 100,
                xattr: md1
            }, dummy_object_sdk);
            const file_path1 = ns_tmp_bucket_path + '/' + src_key;
            let xattr = await get_xattr(file_path1);
            let read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: src_key
            }, dummy_object_sdk);
            assert.deepStrictEqual(md1, read_md_res.xattr);
            assert.deepStrictEqual(xattr, { ...add_user_prefix(read_md_res.xattr) });
            assert.equal(stream_content_type, read_md_res.content_type);

            const copy_source = { bucket: upload_bkt, key: src_key };
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: dst_key,
                copy_source: copy_source,
                size: 100,
                xattr_copy: true,
                xattr: await _get_source_copy_xattr(copy_source, ns_tmp, dummy_object_sdk)
            }, dummy_object_sdk);
            const file_path2 = ns_tmp_bucket_path + '/' + dst_key;
            xattr = await get_xattr(file_path2);
            read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: dst_key
            }, dummy_object_sdk);
            assert.deepStrictEqual(xattr, { ...add_user_prefix(read_md_res.xattr), [XATTR_DIR_CONTENT]: `${read_md_res.size}` });
            assert.deepStrictEqual(md1, read_md_res.xattr);
            assert.equal(stream_content_type, read_md_res.content_type);

        });

        mocha.it(`copy object to a directory dir - size 0`, async function() {
            const src_key = 'obj_to_copy2';
            const dst_key = 'dir_obj_dst2/';

            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: src_key,
                source_stream: empty_stream(),
                size: 0,
                xattr: md1
            }, dummy_object_sdk);
            const file_path1 = ns_tmp_bucket_path + '/' + src_key;
            let xattr = await get_xattr(file_path1);
            const read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: src_key
            }, dummy_object_sdk);

            assert.deepStrictEqual(md1, read_md_res.xattr);
            assert.deepStrictEqual(xattr, { ...add_user_prefix(read_md_res.xattr) });
            assert.equal(stream_content_type, read_md_res.content_type);

            const copy_source = { bucket: upload_bkt, key: src_key };
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: dst_key,
                copy_source: copy_source,
                size: 0,
                xattr_copy: true,
                xattr: await _get_source_copy_xattr(copy_source, ns_tmp, dummy_object_sdk)
            }, dummy_object_sdk);
            const file_path2 = ns_tmp_bucket_path + '/' + dst_key;
            xattr = await get_xattr(file_path2);
            const copy_read_md_res = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: dst_key
            }, dummy_object_sdk);

            assert.deepStrictEqual(xattr, { ...add_user_prefix(copy_read_md_res.xattr), [XATTR_DIR_CONTENT]: `${copy_read_md_res.size}` });
            assert.deepStrictEqual(md1, copy_read_md_res.xattr);
            assert.equal(dir_content_type, copy_read_md_res.content_type);
        });

        mocha.it(`copy object link - with new content type and xattr - should not change`, async function() {
            const bucket = upload_bkt;
            const src_key = 'obj_src1';
            const dst_key = 'obj_dst_link_and_sc';

            await ns_tmp.upload_object({ bucket, key: src_key, source_stream: empty_stream(), size: 0, xattr: md1 }, dummy_object_sdk);
            const read_md_res = await ns_tmp.read_object_md({ bucket, key: src_key }, dummy_object_sdk);

            assert.deepStrictEqual(md1, read_md_res.xattr);
            assert.equal(stream_content_type, read_md_res.content_type);
            const new_xattr = { 'copy_new_xattr_key': 'copy_new_xattr_val' };

            const copy_source = { bucket, key: src_key };
            await ns_tmp.upload_object({
                bucket,
                key: dst_key,
                copy_source,
                size: 0,
                xattr_copy: true,
                content_type: dir_content_type,
                xattr: new_xattr
            }, dummy_object_sdk);

            const dst_md_res = await ns_tmp.read_object_md({ bucket, key: dst_key }, dummy_object_sdk);
            const src_md_res = await ns_tmp.read_object_md({ bucket, key: src_key }, dummy_object_sdk);

            // on link - content type and xattr should not be changed on src and dst
            assert.deepStrictEqual(md1, src_md_res.xattr);
            assert.equal(stream_content_type, src_md_res.content_type);
            assert.deepStrictEqual(md1, dst_md_res.xattr);
            assert.equal(stream_content_type, dst_md_res.content_type);

        });

        mocha.it(`copy object fallback - with new content type and xattr`, async function() {
            const bucket = upload_bkt;
            const src_key = 'obj_src1';
            const dst_key = 'obj_dst_fallback_and_sc';
            // force fallback copy using versioning enabled/suspended
            ns_tmp.versioning = 'SUSPENDED';
            await ns_tmp.upload_object({ bucket, key: src_key, source_stream: empty_stream(), size: 0, xattr: md1 }, dummy_object_sdk);
            const read_md_res = await ns_tmp.read_object_md({ bucket, key: src_key }, dummy_object_sdk);

            assert.deepStrictEqual(md1, read_md_res.xattr);
            assert.equal(stream_content_type, read_md_res.content_type);

            const copy_source = { bucket, key: src_key };
            const new_xattr = { 'copy_new_xattr_key': 'copy_new_xattr_val' };
            await ns_tmp.upload_object({ bucket, key: dst_key, copy_source: copy_source, size: 0,
                xattr_copy: false,
                content_type: dir_content_type,
                xattr: new_xattr,
            }, dummy_object_sdk);

            const dst_md_res = await ns_tmp.read_object_md({ bucket, key: dst_key }, dummy_object_sdk);
            const src_md_res = await ns_tmp.read_object_md({ bucket, key: src_key }, dummy_object_sdk);

            // on fallback - content type and xattr should be changed on dst but not on src
            new_xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
            assert.deepStrictEqual(md1, src_md_res.xattr);
            assert.equal(stream_content_type, src_md_res.content_type);
            assert.deepStrictEqual(new_xattr, dst_md_res.xattr);
            assert.equal(dir_content_type, dst_md_res.content_type);
            assert.deepStrictEqual(md1, read_md_res.xattr);
        });

        mocha.after(async function() {
            const delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk);
            console.log('delete_object response', inspect(delete_res));
        });
    });

    mocha.describe('namespace_fs upload object with tagging', function() {

        const upload_bkt_tagging = 'test_ns_uploads_object_tagging';
        const tmp_fs_path_tagging = path.join(TMP_PATH, 'test_namespace_fs_tagging');
        const ns_tmp_bucket_path_tagging = `${tmp_fs_path_tagging}/${src_bkt}`;
        const ns_tmp_tagging = new NamespaceFS({ bucket_path: ns_tmp_bucket_path_tagging, bucket_id: '3', namespace_resource_id: undefined });
        mocha.before(async () => {
            await P.all(_.map([src_bkt, upload_bkt_tagging], async buck =>
                fs_utils.create_fresh_path(`${tmp_fs_path_tagging}/${buck}`)));
        });
        mocha.after(async () => {
            await P.all(_.map([src_bkt, upload_bkt_tagging], async buck =>
                fs_utils.folder_delete(`${tmp_fs_path_tagging}/${buck}`)));
            await fs_utils.folder_delete(tmp_fs_path_tagging);
        });
        mocha.describe('upload_object (tagging)', function() {
            const upload_key = 'upload_key_1';
            const upload_folder_key = 'upload_folder_key1/';
            const upload_folder_key_without_slash = 'upload_folder_key';
            const data = crypto.randomBytes(100);
            const tagging_1 = [{ key: 'tag1', value: 'val1' }];
            const xattr = { key: 'key1', key2: 'value1' };

            mocha.it('Upload object with tagging', async function() {
                const params = {
                    bucket: upload_bkt_tagging,
                    key: upload_key,
                    xattr,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    tagging: tagging_1,
                };
                const upload_res = await ns_tmp_tagging.upload_object(params, dummy_object_sdk);
                console.log('upload_object (tag) response', inspect(upload_res));
                const tag_res = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_key,
                }, dummy_object_sdk);
                console.log('get_object_tagging response', inspect(tag_res));
                await validate_tagging(tag_res.tagging, tagging_1);
            });

            mocha.it('Upload object with multiple tagging', async function() {
                const tagging_multi = [{ key: 'tag1', value: 'val1' },
                    { key: 'tag2', value: 'val2' },
                    { key: 'tag3', value: 'val3' }
                ];
                const params = {
                    bucket: upload_bkt_tagging,
                    key: upload_key,
                    xattr,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    tagging: tagging_multi,
                };
                const upload_res = await ns_tmp_tagging.upload_object(params, dummy_object_sdk);
                console.log('upload_object (tag) response', inspect(upload_res));
                const tag_res = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_key,
                }, dummy_object_sdk);
                console.log('get_object_tagging response', inspect(tag_res));
                await validate_tagging(tag_res.tagging, tagging_multi);
            });

            mocha.it('Upload object with tagging, update tag', async function() {
                const tagging_2 = [{ key: 'tag2', value: 'val2' }];
                const params = {
                    bucket: upload_bkt_tagging,
                    key: upload_key,
                    xattr,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    tagging: tagging_1,
                };
                const upload_res = await ns_tmp_tagging.upload_object(params, dummy_object_sdk);
                console.log('upload_object (tag) response', inspect(upload_res));
                const tag_res = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_key,
                }, dummy_object_sdk);
                console.log('get_object_tagging response', inspect(tag_res));
                await validate_tagging(tag_res.tagging, tagging_1);

                const update_params = {
                    bucket: upload_bkt_tagging,
                    key: upload_key,
                    xattr,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    tagging: tagging_2,
                };
                const update_upload_res = await ns_tmp_tagging.upload_object(update_params, dummy_object_sdk);
                console.log('upload_object (tag) response after update', inspect(update_upload_res));
                const update_tag_res = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_key,
                }, dummy_object_sdk);
                console.log('get_object_tagging response after update', inspect(tag_res));
                await validate_tagging(update_tag_res.tagging, tagging_2);
            });

            mocha.it('Upload folder object with tagging', async function() {
                const params = {
                    bucket: upload_bkt_tagging,
                    key: upload_folder_key,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    tagging: tagging_1,
                };
                const upload_res = await ns_tmp_tagging.upload_object(params, dummy_object_sdk);
                console.log('upload_object (tag) response', inspect(upload_res));
                const tag_res = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_folder_key,
                }, dummy_object_sdk);
                console.log('get_object_tagging response', inspect(tag_res));
                await validate_tagging(tag_res.tagging, tagging_1);
            });

            mocha.it('Upload folder object with tagging, get object tagging key without slash', async function() {
                const tagging_2 = [{ key: 'tag2', value: 'val2' }];
                const params = {
                    bucket: upload_bkt_tagging,
                    key: upload_folder_key_without_slash,
                    xattr,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    tagging: tagging_2,
                };
                const upload_res = await ns_tmp_tagging.upload_object(params, dummy_object_sdk);
                console.log('upload_object (tag) response', inspect(upload_res));
                const tag_res = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_folder_key_without_slash,
                }, dummy_object_sdk);
                console.log('get_object_tagging response', inspect(tag_res));
                await validate_tagging(tag_res.tagging, tagging_2);
            });

            mocha.it('Upload folder object with tagging and version enabled', async function() {
                ns_tmp_tagging.set_bucket_versioning('ENABLED', dummy_object_sdk);
                const tagging_2 = [{ key: 'tag2', value: 'val2' }];
                const tagging_3 = [{ key: 'tag3', value: 'val3' }];
                const upload_key_2 = 'tagging_upload_key_2';
                const params1 = {
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    tagging: tagging_1,
                };
                const upload_res = await ns_tmp_tagging.upload_object(params1, dummy_object_sdk);
                console.log('upload_object (tag) response', inspect(upload_res));
                const params2 = {
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    tagging: tagging_2,
                };
                const upload_res1 = await ns_tmp_tagging.upload_object(params2, dummy_object_sdk);
                console.log('upload_object (tag) response', inspect(upload_res1));

                //get tag for first version
                const tag_res = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                    version_id: upload_res.version_id,
                }, dummy_object_sdk);
                console.log('get_object_tagging response', inspect(tag_res));
                await validate_tagging(tag_res.tagging, tagging_1);

                // suspend versioning, verion specific tag should retun.
                ns_tmp_tagging.set_bucket_versioning('SUSPENDED', dummy_object_sdk);
                const params3 = {
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    tagging: tagging_3,
                };
                const upload_res2 = await ns_tmp_tagging.upload_object(params3, dummy_object_sdk);
                console.log('upload_object (tag) response', inspect(upload_res2));

                //get tag for second version, after disabling version
                const tag_res1 = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                    version_id: upload_res1.version_id,
                }, dummy_object_sdk);
                console.log('get_object_tagging response', inspect(tag_res1));
                await validate_tagging(tag_res1.tagging, tagging_2);

                //get tag for last item without version id
                const tag_res2 = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                }, dummy_object_sdk);
                console.log('get_object_tagging response', inspect(tag_res2));
                await validate_tagging(tag_res2.tagging, tagging_3);
            });

            mocha.it('get tag with last version', async function() {
                ns_tmp_tagging.set_bucket_versioning('ENABLED', dummy_object_sdk);
                const tagging_2 = [{ key: 'tag2', value: 'val2' }];
                const upload_key_2 = 'tagging_upload_key_2';
                const params1 = {
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    tagging: tagging_1,
                };
                const upload_res = await ns_tmp_tagging.upload_object(params1, dummy_object_sdk);
                console.log('upload_object (tag) response@@@', inspect(upload_res));
                //get tag for first version, with version id
                const tag_res = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                    version_id: upload_res.version_id,
                }, dummy_object_sdk);
                await validate_tagging(tag_res.tagging, tagging_1);
                //get tag for first version, without version id
                const tag_res_1 = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                }, dummy_object_sdk);
                await validate_tagging(tag_res_1.tagging, tagging_1);
                const params2 = {
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                    source_stream: buffer_utils.buffer_to_read_stream(data),
                    tagging: tagging_2,
                };
                const upload_res1 = await ns_tmp_tagging.upload_object(params2, dummy_object_sdk);
                console.log('upload_object (tag) response', inspect(upload_res1));

                //get tag for lates version, with version id
                const tag_res1 = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                    version_id: upload_res1.version_id,
                }, dummy_object_sdk);
                await validate_tagging(tag_res1.tagging, tagging_2);
                //get tag for lates version, without version id
                const tag_res1_1 = await ns_tmp_tagging.get_object_tagging({
                    bucket: upload_bkt_tagging,
                    key: upload_key_2,
                }, dummy_object_sdk);
                await validate_tagging(tag_res1_1.tagging, tagging_2);

            });

        });
    });
});

async function validate_tagging(tag_res, tag_req) {
    let count = 0;
    if (tag_res.length === 0) {
        assert.fail('object tag should not be empty');
    }
    for (const tagging of tag_res) {
        assert.deepStrictEqual(tagging.key, tag_req[count].key);
        assert.deepStrictEqual(tagging.value, tag_req[count].value);
        count += 1;
    }
}

//simulates object_sdk.fix_copy_source_params filtering of source xattr for copy object tests
async function _get_source_copy_xattr(copy_source, source_ns, object_sdk) {
    const read_md_res = await source_ns.read_object_md({
        bucket: copy_source.bucket,
        key: copy_source.key
    }, object_sdk);
    const res = _.omitBy(read_md_res.xattr, (val, name) => name.startsWith?.('noobaa-namespace'));
    return res;
}

async function list_objects(ns, bucket, delimiter, prefix, dummy_object_sdk) {
    const res = await ns.list_objects({
        bucket: bucket,
        delimiter: delimiter,
        prefix: prefix,
    }, dummy_object_sdk);
    console.log(JSON.stringify(res));
    return res;
}

async function upload_object(ns, bucket, file_key, dummy_object_sdk, source) {
    const xattr = { key: 'value', key2: 'value2' };
    xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
    const upload_res = await ns.upload_object({
        bucket: bucket,
        key: file_key,
        xattr,
        source_stream: source
    }, dummy_object_sdk);
    console.log('upload_object response', inspect(upload_res));
    return upload_object;
}

async function delete_object(ns, bucket, file_key, dummy_object_sdk) {
    const delete_copy_res = await ns.delete_object({
        bucket: bucket,
        key: file_key,
    }, dummy_object_sdk);
    console.log('delete_object do not delete the path response', inspect(delete_copy_res));
    return delete_copy_res;
}

async function read_object_md(ns, bucket, file_key, dummy_object_sdk) {
    const res = await ns.read_object_md({
        bucket: bucket,
        key: file_key,
    }, dummy_object_sdk);
    console.log(inspect(res));
    return res;
}

async function read_object_stream(ns, bucket, file_key, dummy_object_sdk) {
    const out = buffer_utils.write_stream();
    await ns.read_object_stream({
        bucket: bucket,
        key: file_key,
    }, dummy_object_sdk, out);
    console.log(inspect(out));
    return out;
}

function create_file(file_path) {
    return fs.promises.appendFile(file_path, file_path + '\n');
}

