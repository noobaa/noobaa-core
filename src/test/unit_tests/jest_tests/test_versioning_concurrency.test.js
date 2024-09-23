/* Copyright (C) 2016 NooBaa */
'use strict';

const path = require('path');
const config = require('../../../../config');
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

const DUMMY_OBJECT_SDK = make_dummy_object_sdk(true);
describe('test versioning concurrency', () => {
    const prior_value_of_nsfs_rename_retries = config.NSFS_RENAME_RETRIES;

    beforeEach(async () => {
        await fs_utils.create_fresh_path(tmp_fs_path);
    });

    afterEach(async () => {
        await fs_utils.folder_delete(tmp_fs_path);
        config.NSFS_RENAME_RETRIES = prior_value_of_nsfs_rename_retries;
    });

    it('multiple puts of the same key', async () => {
        const bucket = 'bucket1';
        const key = 'key1';
        const failed_operations = [];
        for (let i = 0; i < 5; i++) {
            const random_data = Buffer.from(String(i));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK)
                .catch(err => failed_operations.push(err));
        }
        await P.delay(1000);
        expect(failed_operations.length).toBe(0);
        const versions = await nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK);
        expect(versions.objects.length).toBe(5);
    });

    it('multiple delete version id and key', async () => {
        const bucket = 'bucket1';
        const key = 'key2';
        const number_of_versions = 5;
        const versions_arr = await _upload_versions(bucket, key, number_of_versions);

        const mid_version_id = versions_arr[3];
        const number_of_successful_operations = [];
        const failed_operations = [];
        for (let i = 0; i < 15; i++) {
            nsfs.delete_object({ bucket: bucket, key: key, version_id: mid_version_id }, DUMMY_OBJECT_SDK)
                .then(res => number_of_successful_operations.push(res))
                .catch(err => failed_operations.push(err));
        }
        await P.delay(1000);
        expect(failed_operations.length).toBe(0);
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

    it('concurrent delete of latest version', async () => {
        const bucket = 'bucket1';
        const key = 'key3';
        const number_of_versions = 5;
        const versions_arr = await _upload_versions(bucket, key, number_of_versions);
        expect(versions_arr.length).toBe(number_of_versions);

        const successful_operations = [];
        const failed_operations = [];
        for (let i = 0; i < 3; i++) {
            nsfs.delete_object({ bucket: bucket, key: key }, DUMMY_OBJECT_SDK)
                .then(res => successful_operations.push(res))
                .catch(err => failed_operations.push(err));
        }

        await P.delay(1000);
        expect(failed_operations.length).toBe(0);
        expect(successful_operations.length).toBe(3);
        const versions = await nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK);
        expect(versions.objects.length).toBe(8); // 5 versions before + 3 delete markers concurrent
        const delete_marker_arr = versions.objects.filter(object => object.delete_marker === true);
        expect(delete_marker_arr.length).toBe(3);
    });

    it('concurrent put object and head object latest version', async () => {
        const bucket = 'bucket1';
        const key = 'key4';
        await _upload_versions(bucket, key, 1);

        const successful_put_operations = [];
        const successful_head_operations = [];
        const failed_put_operations = [];
        const failed_head_operations = [];
        const number_of_iterations = 10;
        config.NSFS_RENAME_RETRIES = 40;
        for (let i = 0; i < number_of_iterations; i++) {
            const random_data = Buffer.from(String(i));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK)
                .then(res => successful_put_operations.push(res))
                .catch(err => failed_put_operations.push(err));
            nsfs.read_object_md({ bucket: bucket, key: key }, DUMMY_OBJECT_SDK)
                .then(res => successful_head_operations.push(res))
                .catch(err => failed_head_operations.push(err));
        }
        await P.delay(1000);
        expect(failed_put_operations.length).toBe(0);
        expect(failed_head_operations.length).toBe(0);
        expect(successful_head_operations.length).toBe(number_of_iterations);
        const versions = await nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK);
        expect(versions.objects.length).toBe(number_of_iterations + 1); // 1 version before + 10 versions concurrent
    });
});

/**
 * _upload_versions uploads number_of_versions of key in bucket with a body of random data
 * note: this function is not concurrent, it's a helper function for preparing a bucket with a couple of versions
 * @param {string} bucket
 * @param {string} key
 * @param {number} number_of_versions
 */
async function _upload_versions(bucket, key, number_of_versions) {
    const versions_arr = [];
    for (let i = 0; i < number_of_versions; i++) {
        const random_data = Buffer.from(String(i));
        const body = buffer_utils.buffer_to_read_stream(random_data);
        const res = await nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK)
            .catch(err => console.log('put error - ', err));
        versions_arr.push(res.etag);
    }
    return versions_arr;
}
