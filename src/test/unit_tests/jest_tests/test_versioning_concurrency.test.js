/* Copyright (C) 2016 NooBaa */
'use strict';

const path = require('path');
const P = require('../../../util/promise');
const fs_utils = require('../../../util/fs_utils');
const NamespaceFS = require('../../../sdk/namespace_fs');
const buffer_utils = require('../../../util/buffer_utils');
const { TMP_PATH } = require('../../system_tests/test_utils');
const { crypto_random_string } = require('../../../util/string_utils');
const endpoint_stats_collector = require('../../../sdk/endpoint_stats_collector');

function make_dummy_object_sdk(nsfs_config, uid, gid) {
    return {
        requesting_account: {
            nsfs_account_config: nsfs_config && {
                uid: uid || process.getuid(),
                gid: gid || process.getgid(),
                backend: '',
            }
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        }
    };
}

const DUMMY_OBJECT_SDK = make_dummy_object_sdk(true);
describe('test versioning concurrency', () => {
    const tmp_fs_path = path.join(TMP_PATH, 'test_versioning_concurrency');

    const nsfs = new NamespaceFS({
        bucket_path: tmp_fs_path,
        bucket_id: '1',
        namespace_resource_id: undefined,
        access_mode: undefined,
        versioning: 'ENABLED',
        force_md5_etag: false,
        stats: endpoint_stats_collector.instance(),
    });

    beforeEach(async () => {
        await fs_utils.create_fresh_path(tmp_fs_path);
    });

    afterEach(async () => {
        await fs_utils.folder_delete(tmp_fs_path);
    });

    it('multiple puts of the same key', async () => {
        const bucket = 'bucket1';
        const key = 'key1';
        for (let i = 0; i < 5; i++) {
            const random_data = Buffer.from(String(i));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK).catch(err => console.log('multiple puts of the same key error - ', err));
        }
        await P.delay(1000);
        const versions = await nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK);
        expect(versions.objects.length).toBe(5);
    });

    it('multiple delete version id and key', async () => {
        const bucket = 'bucket1';
        const key = 'key2';
        const versions_arr = [];
        // upload 5 versions of key2
        for (let i = 0; i < 5; i++) {
            const random_data = Buffer.from(String(i));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            const res = await nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK).catch(err => console.log('put error - ', err));
            versions_arr.push(res.etag);
        }
        const mid_version_id = versions_arr[3];
        const number_of_successful_operations = [];
        for (let i = 0; i < 15; i++) {
            nsfs.delete_object({ bucket: bucket, key: key, version_id: mid_version_id }, DUMMY_OBJECT_SDK)
                .then(res => number_of_successful_operations.push(res))
                .catch(err => console.log('delete the same key & version id error - ', err));
        }
        await P.delay(1000);
        expect(number_of_successful_operations.length).toBe(15);
    });

    // same as s3tests_boto3/functional/test_s3.py::test_versioning_concurrent_multi_object_delete, 
    // this test has a bug, it tries to create the bucket twice and fails
    // https://github.com/ceph/s3-tests/blob/master/s3tests_boto3/functional/test_s3.py#L1642
    // see - https://github.com/ceph/s3-tests/issues/588
    it('concurrent multi object delete', async () => {
        const bucket = 'bucket1';
        const concurrency_num = 10;
        const delete_objects_arr = [];
        for (let i = 0; i < concurrency_num; i++) {
            const key = `key${i}`;
            const random_data = Buffer.from(String(crypto_random_string(7)));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            const res = await nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK);
            delete_objects_arr.push({ key: key, version_id: res.version_id });
        }
        const versions = await nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK);

        for (const { key, version_id } of delete_objects_arr) {
            const found = versions.objects.find(object => object.key === key && object.version_id === version_id);
            expect(found).toBeDefined();
        }

        const delete_responses = [];
        const delete_errors = [];

        for (let i = 0; i < concurrency_num; i++) {
            nsfs.delete_multiple_objects({ bucket, objects: delete_objects_arr }, DUMMY_OBJECT_SDK)
                .then(res => delete_responses.push(res))
                .catch(err => delete_errors.push(err));
        }
        await P.delay(5000);
        expect(delete_responses.length).toBe(concurrency_num);
        for (const res of delete_responses) {
            expect(res.length).toBe(concurrency_num);
            for (const single_delete_res of res) {
                expect(single_delete_res.err_message).toBe(undefined);
            }
        }
        const list_res = await nsfs.list_objects({ bucket: bucket }, DUMMY_OBJECT_SDK);
        expect(list_res.objects.length).toBe(0);
    }, 8000);
});
