/* Copyright (C) 2016 NooBaa */
/* eslint-disable no-undef */
'use strict';
const path = require('path');
const { TMP_PATH } = require('../../system_tests/test_utils');
const NamespaceFS = require('../../../sdk/namespace_fs');
const buffer_utils = require('../../../util/buffer_utils');
const fs_utils = require('../../../util/fs_utils');

const tmp_ns_nsfs_path = path.join(TMP_PATH, 'test_nsfs_namespace_upload');
const nsfs_src_bkt = 'nsfs_src';
const ns_nsfs_tmp_bucket_path = `${tmp_ns_nsfs_path}/${nsfs_src_bkt}`;
const upload_bkt = 'test_namespace_upload_object';

const data1 = Buffer.from('data1');
const data2 = Buffer.from('data2');
const dummy_object_sdk = make_dummy_object_sdk();
const ns_nsfs_tmp = new NamespaceFS({ bucket_path: ns_nsfs_tmp_bucket_path, bucket_id: '3', namespace_resource_id: undefined });

// TODO : FIX TEST
function make_dummy_object_sdk() {
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
        }
    };
}

// eslint-disable-next-line max-lines-per-function
describe('override key and key/', () => {
    describe('override file with folder', () => {
        beforeAll(async () => {
            await fs_utils.create_fresh_path(ns_nsfs_tmp_bucket_path);
        });
        afterAll(async function() {
            await fs_utils.folder_delete(`${ns_nsfs_tmp_bucket_path}`);
        });
        it('change file to folder', async () => {
            const upload_key_file1 = 'upload_key1';
            const upload_key_folder1 = 'upload_key1/';
            await ns_nsfs_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_file1,
                source_stream: buffer_utils.buffer_to_read_stream(data1)
            }, dummy_object_sdk);
            let res = await ns_nsfs_tmp.list_objects({
                bucket: upload_bkt,
            }, dummy_object_sdk);
            expect(res.objects[0].key).toBe(upload_key_file1);
            const etag = res.objects[0].etag;

            await ns_nsfs_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_folder1,
                source_stream: buffer_utils.buffer_to_read_stream(data2)
            }, dummy_object_sdk);
            res = await ns_nsfs_tmp.list_objects({
                bucket: upload_bkt,
            }, dummy_object_sdk);

            expect(res.objects[0].key).toBe(upload_key_folder1);
            const read_res = buffer_utils.write_stream();
            await ns_nsfs_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key_folder1,
            }, dummy_object_sdk, read_res);
            const read_data = read_res.join();
            expect(Buffer.compare(read_data, data2)).toBe(0);
            expect(res.objects[0].etag).not.toBe(etag);

            await ns_nsfs_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_folder1,
            }, dummy_object_sdk);

        });

        /*it('change folder to file', async () => {
            const upload_key_file2 = 'upload_key2';
            const upload_key_folder2 = 'upload_key2/';
            await ns_nsfs_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_folder2,
                source_stream: buffer_utils.buffer_to_read_stream(data1)
            }, dummy_object_sdk);
            let res = await ns_nsfs_tmp.list_objects({
                bucket: upload_bkt,
            }, dummy_object_sdk);
            //expect(res.objects[0].key).toBe(upload_key_folder2);
            const etag = res.objects[0].etag;

            await ns_nsfs_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_file2,
                source_stream: buffer_utils.buffer_to_read_stream(data2)
            }, dummy_object_sdk);
            res = await ns_nsfs_tmp.list_objects({
                bucket: upload_bkt,
            }, dummy_object_sdk);
            //expect(res.objects[0].key).toBe(upload_key_file2);
            const read_res = buffer_utils.write_stream();
            await ns_nsfs_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key_file2,
            }, dummy_object_sdk, read_res);
            const read_data = read_res.join();
            //expect(Buffer.compare(read_data, data2)).toBe(0);
            //expect(res.objects[0].etag).not.toBe(etag);

            await ns_nsfs_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_file2,
            }, dummy_object_sdk);
        });*/
        it('folder to folder - normal override', async () => {
            const upload_key_folder2 = 'upload_key2/';
            await ns_nsfs_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_folder2,
                source_stream: buffer_utils.buffer_to_read_stream(data1)
            }, dummy_object_sdk);
            /*let res = await ns_nsfs_tmp.list_objects({
                bucket: upload_bkt,
            }, dummy_object_sdk); */
            //expect(res.objects[0].key).toBe(upload_key_folder2);

            await ns_nsfs_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_folder2,
                source_stream: buffer_utils.buffer_to_read_stream(data2)
            }, dummy_object_sdk);
            /*res = await ns_nsfs_tmp.list_objects({
                bucket: upload_bkt,
            }, dummy_object_sdk); */
            //expect(res.objects[0].key).toBe(upload_key_folder2);
            const read_res = buffer_utils.write_stream();
            await ns_nsfs_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key_folder2,
            }, dummy_object_sdk, read_res);
            //const read_data = read_res.join();
            //expect(Buffer.compare(read_data, data2)).toBe(0);

            await ns_nsfs_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_folder2,
            }, dummy_object_sdk);
        });

        it('file to file - normal override', async () => {
            const upload_key_file1 = 'upload_key1/';
            await ns_nsfs_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_file1,
                source_stream: buffer_utils.buffer_to_read_stream(data1)
            }, dummy_object_sdk);
            let res = await ns_nsfs_tmp.list_objects({
                bucket: upload_bkt,
            }, dummy_object_sdk);
            expect(res.objects[0].key).toBe(upload_key_file1);

            await ns_nsfs_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_file1,
                source_stream: buffer_utils.buffer_to_read_stream(data2)
            }, dummy_object_sdk);
            res = await ns_nsfs_tmp.list_objects({
                bucket: upload_bkt,
            }, dummy_object_sdk);
            expect(res.objects[0].key).toBe(upload_key_file1);
            const read_res = buffer_utils.write_stream();
            await ns_nsfs_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key_file1,
            }, dummy_object_sdk, read_res);
            const read_data = read_res.join();
            expect(Buffer.compare(read_data, data2)).toBe(0);

            await ns_nsfs_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_file1,
            }, dummy_object_sdk);
        });
    });
});

