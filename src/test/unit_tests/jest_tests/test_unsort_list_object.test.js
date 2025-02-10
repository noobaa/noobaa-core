/* Copyright (C) 2016 NooBaa */
/* eslint-disable no-undef */
'use strict';


const fs = require('fs');
const path = require('path');
const fs_utils = require('../../../util/fs_utils');
const nb_native = require('../../../util/nb_native');
const { TMP_PATH, make_dummy_object_sdk } = require('../../system_tests/test_utils');
const { get_process_fs_context } = require('../../../util/native_fs_utils');
const NamespaceFS = require('../../../sdk/namespace_fs');
const buffer_utils = require('../../../util/buffer_utils');
const crypto = require('crypto');
const config = require('../../../../config');

const DEFAULT_FS_CONFIG = get_process_fs_context();
config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = true;
const tmp_nsfs_path = path.join(TMP_PATH, 'test_unsort_list_objects');
const upload_bkt = 'test_ns_uploads_object';
const src_bkt = 'src';
const timeout = 50000;
const ns_tmp_bucket_path = `${tmp_nsfs_path}/${src_bkt}`;

const tmp_ns_nsfs_path = path.join(TMP_PATH, 'test_nsfs_unsort_list');
const nsfs_src_bkt = 'nsfs_src';
const ns_nsfs_tmp_bucket_path = `${tmp_ns_nsfs_path}/${nsfs_src_bkt}`;
const list_bkt = 'test_ns_list_object';

const files_without_folders_to_upload = make_keys(264, i => `file_without_folder${i}`);
const folders_to_upload = make_keys(264, i => `folder${i}/`);
const files_in_folders_to_upload = make_keys(264, i => `folder1/file${i}`);
const files_in_utf_diff_delimiter = make_keys(264, i => `תיקיה#קובץ${i}`);
const files_in_inner_folders_to_upload_post = make_keys(264, i => `folder1/inner_folder/file${i}`);
const files_in_inner_folders_to_upload_pre = make_keys(264, i => `folder1/ainner_folder/file${i}`);
const dummy_object_sdk = make_dummy_object_sdk();
const ns_tmp = new NamespaceFS({ bucket_path: ns_tmp_bucket_path, bucket_id: '2', namespace_resource_id: undefined });
const ns_nsfs_tmp = new NamespaceFS({ bucket_path: ns_nsfs_tmp_bucket_path, bucket_id: '3', namespace_resource_id: undefined });

// eslint-disable-next-line max-lines-per-function
describe('manage unsorted list objcts flow', () => {
    const keys_objects = make_keys(999, i => `max_keys_test${i}`);
    describe('Unsorted List objects ', () => {
        const data = crypto.randomBytes(100);

        beforeAll(async () => {
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = true;
            await fs_utils.create_fresh_path(ns_tmp_bucket_path);
        });

        afterAll(async () => {
            await fs_utils.folder_delete(`${ns_tmp_bucket_path}`);
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = false;
        });

        it('List object unsorted with one object upload', async () => {
            const upload_key_2 = 'my_data';
            await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_2,
                source_stream: buffer_utils.buffer_to_read_stream(data),
            }, dummy_object_sdk);
            const ls_obj_res = await ns_tmp.list_objects({
                bucket: upload_bkt,
                delimiter: '/',
            }, dummy_object_sdk);
            expect(ls_obj_res.objects.map(obj => obj.key)).toStrictEqual([upload_key_2]);
        });

        it('List object unsorted with multiple object upload', async () => {
            await create_keys(upload_bkt, ns_tmp, keys_objects);
            const ls_obj_res = await ns_tmp.list_objects({
                bucket: upload_bkt,
                delimiter: '/',
            }, dummy_object_sdk);
            expect(ls_obj_res.objects.map(it => it.key).length).toStrictEqual(keys_objects.length + 1);
        });
    });

    describe('Telldir and Seekdir implementation', () => {
        const tmp_fs_path = path.join(TMP_PATH, 'test_list_object');
        const list_dir_root = path.join(tmp_fs_path, 'list_dir_root');
        const list_dir_1_1 = path.join(list_dir_root, 'list_dir_1_1');
        const total_files = 4;
        beforeAll(async () => {
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = true;
            await fs_utils.create_fresh_path(list_dir_root);
            await fs_utils.create_fresh_path(list_dir_1_1);
            for (let i = 0; i < total_files; i++) {
                create_temp_file(list_dir_root, `test_${i}.json`, {test: test});
            }
        });

        afterAll(async () => {
            await fs_utils.folder_delete(`${list_dir_root}`);
            await fs_utils.folder_delete(`${list_dir_1_1}`);
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = false;
        });

        it('telldir returns bigint', async () => {
            const dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, list_dir_root);
            const tell_dir = await dir_handle.telldir(DEFAULT_FS_CONFIG);
            expect(typeof tell_dir).toStrictEqual('bigint');
        });

        it('seekdir expects bigint', async () => {
            const big_int = 2n ** 32n;
            const dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, list_dir_root);
            const tell_dir = await dir_handle.telldir(DEFAULT_FS_CONFIG);
            expect(() => dir_handle.seekdir(DEFAULT_FS_CONFIG, Number(tell_dir))).toThrow();
            expect(() => dir_handle.seekdir(DEFAULT_FS_CONFIG, 2n ** 32n ** 32n)).toThrow();
            expect(() => dir_handle.seekdir(DEFAULT_FS_CONFIG, -(2n ** 32n ** 32n))).toThrow();
            // valid scenario
            expect(await dir_handle.seekdir(DEFAULT_FS_CONFIG, big_int)).toBeUndefined();

        });

        it('list dir files - telldir and seekdir.', async () => {
            let tell_dir;
            let dir_marker;
            let total_dir_entries = 0;
            let dir_entry;
            let dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, list_dir_root);
            // reak first read after 3 entries.
            for (let i = 0; i <= 2; i++) {
                dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                if (!dir_entry) break;
                tell_dir = await dir_handle.telldir(DEFAULT_FS_CONFIG);
                dir_marker = {
                    dir_path: list_dir_root,
                    pos: tell_dir,
                };
                total_dir_entries += 1;
            }
            // Continue the read using dir location fetch from telldir
            try {
                dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, dir_marker.dir_path);
                await dir_handle.seekdir(DEFAULT_FS_CONFIG, dir_marker.pos);
                for (;;) {
                    dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                    if (!dir_entry) break;
                    total_dir_entries += 1;
                }
                await dir_handle.close(DEFAULT_FS_CONFIG);
                dir_handle = null;
            } catch (err) {
                console.log("Error :", err);
            }
            //total number of dir and files inside list_dir_root is 5 
            expect(total_dir_entries).toBe(total_files + 1);
        });

        it('list dir files -  Dir.read() and seekdir()', async () => {
            let dir_marker;
            let total_dir_entries = 0;
            let dir_entry;
            let dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, list_dir_root);
            // reak first read after 3 entries.
            for (let i = 0; i <= 2; i++) {
                dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                if (!dir_entry) break;
                const tell_dir = await dir_handle.telldir(DEFAULT_FS_CONFIG);
                //verify tell_dir and dir_entry.off return same value
                expect(tell_dir).toBe(dir_entry.off);
                dir_marker = {
                    dir_path: list_dir_root,
                    pos: dir_entry.off,
                };
                total_dir_entries += 1;
            }
            // Continue the read using dir location fetch from Dir.read()
            try {
                dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, dir_marker.dir_path);
                await dir_handle.seekdir(DEFAULT_FS_CONFIG, dir_marker.pos);
                for (;;) {
                    dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                    if (!dir_entry) break;
                    total_dir_entries += 1;
                }
                await dir_handle.close(DEFAULT_FS_CONFIG);
                dir_handle = null;
            } catch (err) {
                console.log("Error :", err);
            }
            //total number of dir and files inside list_dir_root is 5 
            expect(total_dir_entries).toBe(total_files + 1);
        });

        it('list 10000 dir files - telldir and seekdir', async () => {
            for (let i = total_files; i < total_files + 9995; i++) {
                create_temp_file(list_dir_root, `test_${i}.json`, {test: test});
            }
            let tell_dir;
            let dir_marker;
            let total_dir_entries = 0;
            let dir_entry;
            let dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, list_dir_root);
            // Seak first read after 3 entries.
            for (let i = 0; i <= 500; i++) {
                dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                if (!dir_entry) break;
                tell_dir = await dir_handle.telldir(DEFAULT_FS_CONFIG);
                dir_marker = {
                    dir_path: list_dir_root,
                    pos: tell_dir,
                };
                total_dir_entries += 1;
            }
            // Continue the read using dir location fetch from telldir
            try {
                dir_handle = await nb_native().fs.opendir(DEFAULT_FS_CONFIG, dir_marker.dir_path);
                await dir_handle.seekdir(DEFAULT_FS_CONFIG, dir_marker.pos);
                for (;;) {
                    dir_entry = await dir_handle.read(DEFAULT_FS_CONFIG);
                    if (!dir_entry) break;
                    total_dir_entries += 1;
                }
                await dir_handle.close(DEFAULT_FS_CONFIG);
                dir_handle = null;
            } catch (err) {
                console.log("Error :", err);
            }
            //total number of dir and files inside list_dir_root is 5 
            expect(total_dir_entries).toBe(10000);
        });
    });


    describe('list objects - dirs', () => {
        beforeAll(async () => {
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = true;
            await fs_utils.create_fresh_path(ns_tmp_bucket_path);
            await create_keys(upload_bkt, ns_tmp, [
                ...folders_to_upload,
                ...files_in_folders_to_upload,
                ...files_without_folders_to_upload,
                ...files_in_utf_diff_delimiter,
                ...files_in_inner_folders_to_upload_pre,
                ...files_in_inner_folders_to_upload_post
            ]);
        });
        afterAll(async () => {
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = false;
            await delete_keys(upload_bkt, ns_tmp, [
                ...folders_to_upload,
                ...files_in_folders_to_upload,
                ...files_without_folders_to_upload,
                ...files_in_utf_diff_delimiter,
                ...files_in_inner_folders_to_upload_pre,
                ...files_in_inner_folders_to_upload_post
            ]);
            await fs_utils.folder_delete(`${ns_tmp_bucket_path}`);
        }, timeout);
        it('key_marker=folder229/', async () => {
            const r = await ns_tmp.list_objects({
                bucket: upload_bkt,
                list_type: "2",
                key_marker: 'folder229/'
            }, dummy_object_sdk);
            expect(r.is_truncated).toStrictEqual(false);
            expect(r.common_prefixes).toStrictEqual([]);
            const fd = folders_to_upload.filter(folder => folder > 'folder229/');
            expect(r.objects.map(it => it.key).sort()).toStrictEqual([...fd, ...files_in_utf_diff_delimiter].sort());
        });

        it('key_marker=folder229', async function() {
            const r = await ns_tmp.list_objects({
                bucket: upload_bkt,
                list_type: "2",
                key_marker: 'folder229'
            }, dummy_object_sdk);
            expect(r.is_truncated).toStrictEqual(false);
            expect(r.common_prefixes).toStrictEqual([]);
            const fd = folders_to_upload.filter(folder => folder >= 'folder229/');
            expect(r.objects.map(it => it.key).sort()).toEqual([...fd, ...files_in_utf_diff_delimiter].sort());
        });

        it('key_marker=folder1/', async function() {
            const r = await ns_tmp.list_objects({
                bucket: upload_bkt,
                list_type: "2",
                key_marker: 'folder1/'
            }, dummy_object_sdk);
            expect(r.is_truncated).toStrictEqual(true);
            expect(r.common_prefixes).toStrictEqual([]);
            expect(r.objects.length).toEqual(1000);
            expect(r.objects.map(it => it.key)).not.toContain("folder0/");
        });

        it('key_marker=folder1/file57', async function() {
            const r = await ns_tmp.list_objects({
                bucket: upload_bkt,
                list_type: "2",
                key_marker: 'folder1/file57'
            }, dummy_object_sdk);
            expect(r.is_truncated).toStrictEqual(false);
            expect(r.common_prefixes).toStrictEqual([]);
            const fd = folders_to_upload.filter(folder => folder > 'folder1/');
            const fd1 = files_in_folders_to_upload.filter(folder => folder > 'folder1/file57');
            expect(r.objects.map(it => it.key).sort()).toEqual([...fd1, ...files_in_inner_folders_to_upload_post,
                ...fd, ...files_in_utf_diff_delimiter].sort());
        });
        it('key_marker=folder1/inner_folder/file40', async function() {
            const r = await ns_tmp.list_objects({
                bucket: upload_bkt,
                list_type: "2",
                key_marker: 'folder1/inner_folder/file40'
            }, dummy_object_sdk);
            expect(r.is_truncated).toStrictEqual(false);
            expect(r.common_prefixes).toStrictEqual([]);
            const fd1 = files_in_inner_folders_to_upload_post.filter(file => file > 'folder1/inner_folder/file40');
            const fd = folders_to_upload.filter(folder => folder > 'folder1/');
            expect(r.objects.map(it => it.key).sort()).toEqual([...fd1, ...fd, ...files_in_utf_diff_delimiter].sort());
        });

        it('key_marker=folder1/inner_folder/', async function() {
            const r = await ns_tmp.list_objects({
                bucket: upload_bkt,
                list_type: '2',
                key_marker: 'folder1/inner_folder/'
            }, dummy_object_sdk);
            expect(r.is_truncated).toStrictEqual(false);
            expect(r.common_prefixes).toStrictEqual([]);
            const fd1 = files_in_inner_folders_to_upload_post.filter(file => file > 'folder1/inner_folder/');
            const fd = folders_to_upload.filter(folder => folder > 'folder1/inner_folder/');
            expect(r.objects.map(it => it.key).sort()).toEqual([...fd1, ...fd, ...files_in_utf_diff_delimiter].sort());
        });

        it('key_marker=folder1/ainner_folder/', async function() {
            const r = await ns_tmp.list_objects({
                bucket: upload_bkt,
                list_type: '2',
                key_marker: 'folder1/ainner_folder/file50'
            }, dummy_object_sdk);
            expect(r.is_truncated).toStrictEqual(true);
            expect(r.common_prefixes).toStrictEqual([]);
            expect(r.objects.length).toEqual(1000);
            expect(r.objects.map(it => it.key)).not.toContain("folder1/ainner_folder/file50");
            expect(r.objects.map(it => it.key)).not.toContain("folder1/ainner_folder/file49");
        });
    });

    describe('list objects - pagination', () => {
        beforeAll(async () => {
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = true;
            await fs_utils.create_fresh_path(ns_nsfs_tmp_bucket_path);
            await create_keys(list_bkt, ns_nsfs_tmp, [
                ...files_without_folders_to_upload,
                ...folders_to_upload,
                ...files_in_folders_to_upload,
                ...files_in_inner_folders_to_upload_post,
                ...files_in_inner_folders_to_upload_pre,
                ...files_in_utf_diff_delimiter,
            ]);
        }, timeout);
        afterAll(async () => {
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = false;
            await delete_keys(list_bkt, ns_nsfs_tmp, [
                ...folders_to_upload,
                ...files_in_folders_to_upload,
                ...files_without_folders_to_upload,
                ...files_in_utf_diff_delimiter,
                ...files_in_inner_folders_to_upload_pre,
                ...files_in_inner_folders_to_upload_post
            ]);
            await fs_utils.folder_delete(`${ns_nsfs_tmp_bucket_path}`);
        });
        it('page=1000 and list_type 2', async () => {
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = true;
            let r;
            let total_items = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    list_type: "2",
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                total_items += r.objects.length;
                await validat_pagination(r, total_items);
                if (!r.next_marker) {
                    break;
                }
            }
        }, timeout);
        it('page=500 and list_type 2', async () => {
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = true;
            let r;
            let total_items = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    list_type: "2",
                    limit: 500,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                total_items += r.objects.length;
                await validat_pagination(r, total_items);
                if (!r.next_marker) {
                    break;
                }
            }
        }, timeout);
        it('page=250 and list_type 2', async () => {
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = true;
            let r;
            let total_items = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    list_type: "2",
                    limit: 250,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                total_items += r.objects.length;
                await validat_pagination(r, total_items);
                if (!r.next_marker) {
                    break;
                }
            }
        }, timeout);
        it('page=100 and list_type 2', async () => {
            config.NSFS_LIST_OBJECTS_V2_UNSORTED_ENABLED = true;
            let r;
            let total_items = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    list_type: "2",
                    limit: 100,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                total_items += r.objects.length;
                await validat_pagination(r, total_items);
                if (!r.next_marker) {
                    break;
                }
            }
        }, timeout);
        it('page=250 and list_type 1', async () => {
            let r;
            let total_items = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    limit: 250,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                total_items += r.objects.length;
                await validat_pagination(r, total_items);
                if (!r.next_marker) {
                    break;
                }
            }
        });
        it('page=500 and list_type 1', async () => {
            let r;
            let total_items = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    limit: 500,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                total_items += r.objects.length;
                await validat_pagination(r, total_items);
                if (!r.next_marker) {
                    break;
                }
            }
        });
        it('page=1000 and list_type 1', async () => {
            let r;
            let total_items = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                total_items += r.objects.length;
                await validat_pagination(r, total_items);
                if (!r.next_marker) {
                    break;
                }
            }
        });
    });
});


async function validat_pagination(r, total_items) {
    if (r.next_marker) {
        expect(r.is_truncated).toStrictEqual(true);
    } else {
        expect(total_items).toEqual(1584);
        expect(r.is_truncated).toStrictEqual(false);
    }
}
/**
 * @param {number} count 
 * @param {(i:number)=>string} gen 
 * @returns {string[]}
 */
function make_keys(count, gen) {
    const arr = new Array(count);
    for (let i = 0; i < count; ++i) arr[i] = gen(i);
    arr.sort();
    Object.freeze(arr);
    return arr;
}

async function delete_keys(bkt, nsfs_delete_tmp, keys) {
    await nsfs_delete_tmp.delete_multiple_objects({
        bucket: bkt,
        objects: keys.map(key => ({ key })),
    }, dummy_object_sdk);
}

async function create_keys(bkt, nsfs_create_tmp, keys) {
    return Promise.all(keys.map(async key => {
        await nsfs_create_tmp.upload_object({
            bucket: bkt,
            key,
            content_type: 'application/octet-stream',
            source_stream: buffer_utils.buffer_to_read_stream(null),
            size: 0
        }, dummy_object_sdk);
    }));
}

/** 
 * create_temp_file would create a file with the data
 * @param {string} path_to_dir
 * @param {string} file_name
 * @param {object} data
 */
async function create_temp_file(path_to_dir, file_name, data) {
    const path_to_temp_file_name = path.join(path_to_dir, file_name);
    const content = JSON.stringify(data);
    await fs.promises.writeFile(path_to_temp_file_name, content);
    return path_to_temp_file_name;
}
