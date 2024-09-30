/* Copyright (C) 2016 NooBaa */
'use strict';

const path = require('path');
const fs_utils = require('../../../util/fs_utils');
const { TMP_PATH } = require('../../system_tests/test_utils');
const buffer_utils = require('../../../util/buffer_utils');
const NamespaceFS = require('../../../sdk/namespace_fs');
const SensitiveString = require('../../../util/sensitive_string');

const dummy_object_sdk = make_dummy_object_sdk();
const files_in_folders_to_upload = make_keys(4, i => `populatefs_dir/migrateDir.popFSDir.3803140/sparseDir/lnk.${i}.qqqqqqqqqqqqqq`);
const files_in_folders_to_upload_with_sufix = make_keys(4, i => `populatefs_dir/migrateDir.popFSDir.3803140.OldSet/sparseDir/lnk.${i}.qqqqqqqqqqqqqq`);


const files_folder_same_name_file = make_keys(4, i => `populatefs_dir/third_party/cm256.gyp`);
const files_folder_same_name_folder = make_keys(4, i => `populatefs_dir/third_party/cm256/test/test.txt`);


const tmp_nsfs_path = path.join(TMP_PATH, 'test_unsort_list_objects');
const upload_bkt = 'test_ns_uploads_object';
const src_bkt = 'src';
const ns_tmp_bucket_path = `${tmp_nsfs_path}/${src_bkt}`;
const ns_tmp = new NamespaceFS({ bucket_path: ns_tmp_bucket_path, bucket_id: '2', namespace_resource_id: undefined });



describe('namespace_fs list object - corner case', () => {
    describe('list object', () => {
        beforeAll(async () => {
            await fs_utils.create_fresh_path(ns_tmp_bucket_path);
            await create_keys(upload_bkt, ns_tmp, [
                ...files_in_folders_to_upload,
                ...files_in_folders_to_upload_with_sufix,
                ...files_folder_same_name_file,
                ...files_folder_same_name_folder,
            ]);
        });

        afterAll(async () => {
            await delete_keys(upload_bkt, ns_tmp, [
                ...files_in_folders_to_upload,
                ...files_in_folders_to_upload_with_sufix,
                ...files_folder_same_name_file,
                ...files_folder_same_name_folder,
            ]);
            await fs_utils.folder_delete(`${ns_tmp_bucket_path}`);
        });

        it('list object - two folder - one with sufix', async () => {
            let r;
            let total_items = 0;
            for (;;) {
                r = await ns_tmp.list_objects({
                    bucket: upload_bkt,
                    limit: 2,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                total_items += r.objects.length;
                await validat_pagination(r, total_items);
                if (!r.next_marker) {
                    break;
                }
            }
        });

        it('list object - file and folder with same name', async () => {
            let r;
            let total_items = 0;
            for (;;) {
                r = await ns_tmp.list_objects({
                    bucket: upload_bkt,
                    limit: 3,
                    key_marker: r ? r.next_marker : "",
                }, dummy_object_sdk);
                total_items += r.objects.length;
                await validate_order(r);
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
        //expect(total_items).toEqual(10);
        expect(r.is_truncated).toStrictEqual(false);
    }
}

async function validate_order(r) {
    let prev_key = '';
    for (const { key } of r.objects) {
        if (key === 'populatefs_dir/third_party/cm256/test/test.txt') {
            expect(prev_key).toEqual('populatefs_dir/third_party/cm256.gyp');
        }
        prev_key = key;
    }
}

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
        },

        read_bucket_sdk_config_info(name) {
            return {
                bucket_owner: new SensitiveString('dummy-owner'),
                owner_account: {
                    id: 'dummy-id-123',
                }
            };
        }
    };
}
