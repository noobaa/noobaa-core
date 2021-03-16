/* Copyright (C) 2020 NooBaa */
'use strict';

const mocha = require('mocha');
const util = require('util');
const crypto = require('crypto');
const assert = require('assert');
const fs_utils = require('../../util/fs_utils');
const NamespaceFS = require('../../sdk/namespace_fs');
const buffer_utils = require('../../util/buffer_utils');
const test_ns_list_objects = require('./test_ns_list_objects');

const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr });

mocha.describe('namespace_fs', function() {

    const src_bkt = 'src_bucket';
    const src_key = 'test/unit_tests/test_namespace_fs.js';
    const tmp_fs_path = '/tmp/test_namespace_fs';

    const ns_src = new NamespaceFS({fs_path: 'src'});
    const ns_tmp = new NamespaceFS({ fs_path: tmp_fs_path});

    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_path));
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_path));

    mocha.describe('list_objects', function() {

        mocha.it('list src dir with delimiter', async function() {
            const res = await ns_src.list_objects({
                bucket: src_bkt,
                delimiter: '/',
            });
            console.log(inspect(res, res.length));
            assert_sorted_list(res);
        });

        mocha.it('list src dir without delimiter', async function() {
            const res = await ns_src.list_objects({
                bucket: src_bkt,
            });
            console.log(inspect(res, res.length));
            assert.deepStrictEqual(res.common_prefixes, []);
            assert_sorted_list(res);
        });

        mocha.it('list_object_versions', async function() {
            const res = await ns_src.list_object_versions({
                bucket: src_bkt,
                delimiter: '/',
            });
            console.log(inspect(res, res.length));
            assert_sorted_list(res);
        });

        // include all the generic list tests
        test_ns_list_objects(ns_tmp, null, 'test_ns_list_objects');

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
        });
        console.log(inspect(res));
    });

    mocha.describe('read_object_stream', function() {

        mocha.it('read full', async function() {
            const out = buffer_utils.write_stream();
            await ns_src.read_object_stream({
                bucket: src_bkt,
                key: src_key,
            }, null, out);
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
            }, null, out);
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
            }, null, out);
            const res = out.join().toString();
            assert.strict.equal(res, '');
        });
    });

    mocha.describe('upload_object', function() {

        const upload_bkt = 'test_ns_uploads_object';
        const upload_key = 'upload_key_1';

        mocha.it('upload, read, delete of a small object', async function() {
            const data = crypto.randomBytes(100);
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            });
            console.log('upload_object response', inspect(upload_res));

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key,
            }, null, read_res);
            console.log('read_object_stream response', inspect(read_res));
            const read_data = read_res.join();
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key,
            });
            console.log('delete_object response', inspect(delete_res));
        });
    });


    mocha.describe('multipart upload', function() {

        const mpu_bkt = 'test_ns_multipart_upload';
        const mpu_key = 'mpu_upload';

        mocha.it('upload, read, delete a small multipart object', async function() {
            this.timeout(20000); // eslint-disable-line no-invalid-this

            const create_res = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: mpu_key,
            });
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
                });
                console.log('upload_multipart response', inspect(part_res));
                multiparts.push({ num: i + 1, etag: part_res.etag });

                const list_parts_res = await ns_tmp.list_multiparts({
                    obj_id,
                    bucket: mpu_bkt,
                    key: mpu_key,
                });
                console.log('list_multiparts response', inspect(list_parts_res));
            }

            const list1_res = await ns_src.list_uploads({
                bucket: mpu_bkt,
            });
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
            });
            console.log('complete_object_upload response', inspect(complete_res));

            const list2_res = await ns_src.list_uploads({
                bucket: mpu_bkt,
            });
            console.log('list_uploads response', inspect(list2_res));
            assert.deepStrictEqual(list2_res.objects, []);

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: mpu_bkt,
                key: mpu_key,
            }, null, read_res);
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
            });
            console.log('delete_object response', inspect(delete_res));
        });
    });

});
