/* Copyright (C) 2016 NooBaa */
/* eslint-disable no-undef */
'use strict';
const path = require('path');
const fs_utils = require('../../../util/fs_utils');
const { TMP_PATH } = require('../../system_tests/test_utils');
const NamespaceFS = require('../../../sdk/namespace_fs');
const buffer_utils = require('../../../util/buffer_utils');
const tmp_ns_nsfs_path = path.join(TMP_PATH, 'test_nsfs_namespace_list');
const nsfs_src_bkt = 'nsfs_src';
const ns_nsfs_tmp_bucket_path = `${tmp_ns_nsfs_path}/${nsfs_src_bkt}`;
const list_bkt = 'test_namespace_list_object';
const timeout = 50000;
const files_without_folders_to_upload = make_keys(264, i => `file_without_folder${i}`);
const folders_to_upload = make_keys(264, i => `folder${i}/`);
const files_in_folders_to_upload = make_keys(264, i => `folder1/file${i}`);
const files_in_inner_folders_to_upload = make_keys(264, i => `folder1/inner_folder/file${i}`);
const files_in_inner_backup_folders_to_upload = make_keys(264, i => `folder1/inner_folder.backup/file${i}`);
const files_in_inner_all_backup_folders_to_upload = make_keys(264, i => `folder1/inner.folder.all.backup/file${i}`);
const files_in_inner_all_folders_to_upload = make_keys(264, i => `folder1/inner_folder.all/file${i}`);
const dummy_object_sdk = make_dummy_object_sdk();
const ns_nsfs_tmp = new NamespaceFS({ bucket_path: ns_nsfs_tmp_bucket_path, bucket_id: '3', namespace_resource_id: undefined });
let sorted_all_dir_entries;
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
function sort_entries_by_name(a, b) {
    if (a.replaceAll('/', ' ') < b.replaceAll('/', ' ')) return -1;
    if (a.replaceAll('/', ' ') > b.replaceAll('/', ' ')) return 1;
    return 0;
}
// eslint-disable-next-line max-lines-per-function
describe('manage sorted list flow', () => {
    describe('list objects - pagination', () => {
        beforeAll(async () => {
            await fs_utils.create_fresh_path(ns_nsfs_tmp_bucket_path);
            await create_keys(list_bkt, ns_nsfs_tmp, [
                ...files_without_folders_to_upload,
                ...folders_to_upload,
                ...files_in_folders_to_upload,
                ...files_in_inner_folders_to_upload,
                ...files_in_inner_backup_folders_to_upload,
                ...files_in_inner_all_backup_folders_to_upload,
                ...files_in_inner_all_folders_to_upload,
            ]);
            sorted_all_dir_entries = [
                ...files_without_folders_to_upload,
                ...folders_to_upload,
                ...files_in_folders_to_upload,
                ...files_in_inner_folders_to_upload,
                ...files_in_inner_backup_folders_to_upload,
                ...files_in_inner_all_backup_folders_to_upload,
                ...files_in_inner_all_folders_to_upload,
            ];
            sorted_all_dir_entries.sort(sort_entries_by_name);
        }, timeout);
        afterAll(async function() {
            await delete_keys(list_bkt, ns_nsfs_tmp, [
                ...folders_to_upload,
                ...files_in_folders_to_upload,
                ...files_without_folders_to_upload,
                ...files_in_inner_folders_to_upload,
                ...files_in_inner_backup_folders_to_upload,
                ...files_in_inner_all_backup_folders_to_upload,
                ...files_in_inner_all_folders_to_upload,
            ]);
            await fs_utils.folder_delete(`${ns_nsfs_tmp_bucket_path}`);
        });
        it('page=1000', async () => {
            let r;
            let total_items = 0;
            let object_item_start_index = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                object_item_start_index = total_items;
                total_items += r.objects.length;
                await validat_pagination(r, total_items, object_item_start_index);
                if (!r.next_marker) {
                    break;
                }
            }
        }, timeout);
        it('page=500', async () => {
            let r;
            let total_items = 0;
            let object_item_start_index = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    limit: 500,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                object_item_start_index = total_items;
                total_items += r.objects.length;
                await validat_pagination(r, total_items, object_item_start_index);
                if (!r.next_marker) {
                    break;
                }
            }
        }, timeout);
        it('page=264', async () => {
            let r;
            let total_items = 0;
            let object_item_start_index = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    limit: 264,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                object_item_start_index = total_items;
                total_items += r.objects.length;
                await validat_pagination(r, total_items, object_item_start_index);
                if (!r.next_marker) {
                    break;
                }
            }
        }, timeout);
        it('page=250', async () => {
            let r;
            let total_items = 0;
            let object_item_start_index = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    limit: 250,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                object_item_start_index = total_items;
                total_items += r.objects.length;
                await validat_pagination(r, total_items, object_item_start_index);
                if (!r.next_marker) {
                    break;
                }
            }
        }, timeout);
        it('page=100', async () => {
            let r;
            let total_items = 0;
            let object_item_start_index = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    limit: 100,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                object_item_start_index = total_items;
                total_items += r.objects.length;
                await validat_pagination(r, total_items, object_item_start_index);
                if (!r.next_marker) {
                    break;
                }
            }
        }, timeout);
        it('page=10', async () => {
            let r;
            let total_items = 0;
            let object_item_start_index = 0;
            for (;;) {
                r = await ns_nsfs_tmp.list_objects({
                    bucket: list_bkt,
                    limit: 10,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                object_item_start_index = total_items;
                total_items += r.objects.length;
                await validat_pagination(r, total_items, object_item_start_index);
                if (!r.next_marker) {
                    break;
                }
            }
        }, timeout);
    });
});
async function validat_pagination(r, total_items, object_item_start_index) {
    if (r.next_marker) {
        expect(r.is_truncated).toStrictEqual(true);
        expect(r.objects.map(it => it.key)).toEqual(sorted_all_dir_entries.slice(object_item_start_index, total_items));
    } else {
        expect(total_items).toEqual(1848);
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
