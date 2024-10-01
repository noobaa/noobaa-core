/* Copyright (C) 2016 NooBaa */
/* eslint-disable max-lines-per-function */
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
        const successful_operations = [];
        const num_of_concurrency = 5;
        for (let i = 0; i < num_of_concurrency; i++) {
            const random_data = Buffer.from(String(i));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK)
                .catch(err => failed_operations.push(err))
                .then(res => successful_operations.push(res));
        }
        await P.delay(2000);
        expect(successful_operations).toHaveLength(num_of_concurrency);
        expect(failed_operations).toHaveLength(0);
        const versions = await nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK);
        expect(versions.objects.length).toBe(num_of_concurrency);
    });

    it('multiple delete version id and key', async () => {
        const bucket = 'bucket1';
        const key = 'key2';
        const number_of_versions = 5;
        const versions_arr = await _upload_versions(bucket, key, number_of_versions);

        const mid_version_id = versions_arr[3].version_id;
        const successful_operations = [];
        const failed_operations = [];
        const num_of_concurrency = 15;
        for (let i = 0; i < num_of_concurrency; i++) {
            nsfs.delete_object({ bucket: bucket, key: key, version_id: mid_version_id }, DUMMY_OBJECT_SDK)
                .then(res => successful_operations.push(res))
                .catch(err => failed_operations.push(err));
        }
        await P.delay(1000);
        expect(successful_operations).toHaveLength(num_of_concurrency);
        expect(failed_operations).toHaveLength(0);
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
            const versions_arr = await _upload_versions(bucket, key, 1);
            const version = versions_arr[0];
            delete_objects_arr.push({ key: key, version_id: version.version_id });
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
    it('concurrent puts & delete latest objects', async () => {
        const bucket = 'bucket1';
        const key = 'key3';
        const upload_res_arr = [];
        const delete_res_arr = [];
        const delete_err_arr = [];
        const upload_err_arr = [];
        const initial_num_of_versions = 3;
        await _upload_versions(bucket, key, initial_num_of_versions);

        const num_of_concurrency = 2;
        for (let i = 0; i < num_of_concurrency; i++) {
            const random_data = Buffer.from(String(crypto_random_string(7)));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK)
                .then(res => upload_res_arr.push(res.etag))
                .catch(err => upload_err_arr.push(err));
            nsfs.delete_object({ bucket: bucket, key: key }, DUMMY_OBJECT_SDK)
                .then(res => delete_res_arr.push(res.created_version_id))
                .catch(err => delete_err_arr.push(err));
        }
        await P.delay(2000);
        expect(upload_res_arr).toHaveLength(num_of_concurrency);
        expect(delete_res_arr).toHaveLength(num_of_concurrency);
        expect(upload_err_arr).toHaveLength(0);
        expect(delete_err_arr).toHaveLength(0);
        const versions = await nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK);
        expect(versions.objects.length).toBe(initial_num_of_versions + 2 * num_of_concurrency);
        const num_of_delete_markers = (versions.objects.filter(version => version.delete_marker === true)).length;
        expect(num_of_delete_markers).toBe(num_of_concurrency);
        const num_of_latest_versions = (versions.objects.filter(version => version.is_latest === true)).length;
        expect(num_of_latest_versions).toBe(1);
    }, 6000);

    it('concurrent puts & delete objects by version id', async () => {
        const bucket = 'bucket1';
        const key = 'key4';
        const upload_res_arr = [];
        const delete_res_arr = [];
        const delete_err_arr = [];
        const upload_err_arr = [];
        const initial_num_of_versions = 3;
        const versions_arr = await _upload_versions(bucket, key, initial_num_of_versions);

        const num_of_concurrency = 3;
        for (let i = 0; i < num_of_concurrency; i++) {
            const random_data = Buffer.from(String(crypto_random_string(7)));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK)
                .then(res => upload_res_arr.push(res.etag))
                .catch(err => upload_err_arr.push(err));
            nsfs.delete_object({ bucket: bucket, key: key, version_id: versions_arr[i].version_id }, DUMMY_OBJECT_SDK)
                .then(res => delete_res_arr.push(res.deleted_version_id))
                .catch(err => delete_err_arr.push(err));
        }
        await P.delay(2000);
        expect(upload_res_arr).toHaveLength(num_of_concurrency);
        expect(delete_res_arr).toHaveLength(num_of_concurrency);
        expect(upload_err_arr).toHaveLength(0);
        expect(delete_err_arr).toHaveLength(0);
        const versions = await nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK);
        expect(versions.objects.length).toBe(num_of_concurrency);
        const num_of_delete_markers = (versions.objects.filter(version => version.delete_marker === true)).length;
        expect(num_of_delete_markers).toBe(0);
        const num_of_latest_versions = (versions.objects.filter(version => version.is_latest === true)).length;
        expect(num_of_latest_versions).toBe(1);
    }, 6000);

    // currently being skipped because it's not passing - probably a bug that we need to fix
    it.skip('concurrent delete objects by version id/latest', async () => {
        const bucket = 'bucket1';
        const key = 'key5';
        const delete_ver_res_arr = [];
        const delete_ver_err_arr = [];
        const delete_res_arr = [];
        const delete_err_arr = [];
        const initial_num_of_versions = 1;
        const versions_arr = await _upload_versions(bucket, key, initial_num_of_versions);
        const version_id_to_delete = versions_arr[initial_num_of_versions - 1].version_id;
        const num_of_concurrency = initial_num_of_versions;
        for (let i = 0; i < num_of_concurrency; i++) {
            nsfs.delete_object({ bucket: bucket, key: key, version_id: version_id_to_delete }, DUMMY_OBJECT_SDK)
                .then(res => delete_ver_res_arr.push(res.deleted_version_id))
                .catch(err => delete_ver_err_arr.push(err));
            nsfs.delete_object({ bucket: bucket, key: key }, DUMMY_OBJECT_SDK)
                .then(res => delete_res_arr.push(res))
                .catch(err => delete_err_arr.push(err));
        }
        await P.delay(2000);
        expect(delete_ver_res_arr).toHaveLength(num_of_concurrency);
        expect(delete_res_arr).toHaveLength(num_of_concurrency);
        expect(delete_ver_err_arr).toHaveLength(0);
        expect(delete_err_arr).toHaveLength(0);
        const versions = await nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK);

        expect(versions.objects).toHaveLength(num_of_concurrency);
        const num_of_delete_markers = (versions.objects.filter(version => version.delete_marker === true)).length;
        expect(num_of_delete_markers).toBe(num_of_concurrency);
        const num_of_latest_versions = (versions.objects.filter(version => version.is_latest === true)).length;
        expect(num_of_latest_versions).toBe(1);
    }, 6000);

    it('nested key - concurrent delete multiple objects', async () => {
        const bucket = 'bucket1';
        const key = 'dir2/key2';
        const initial_num_of_versions = 10;
        const num_of_concurrency = 10;
        const delete_successful_operations = [];
        const delete_failed_operations = [];

        const inital_versions = await _upload_versions(bucket, key, initial_num_of_versions);
        expect(inital_versions).toHaveLength(initial_num_of_versions);

        const versions = await nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK);
        expect(versions.objects).toHaveLength(initial_num_of_versions);
        for (const { version_id } of inital_versions) {
            const found = versions.objects.find(object => object.key === key && object.version_id === version_id);
            expect(found).toBeDefined();
        }
        for (let i = 0; i < num_of_concurrency; i++) {
            nsfs.delete_multiple_objects({ bucket, objects: inital_versions }, DUMMY_OBJECT_SDK)
                .then(res => delete_successful_operations.push(res))
                .catch(err => delete_failed_operations.push(err));
        }

        await P.delay(2000);
        expect(delete_successful_operations).toHaveLength(num_of_concurrency);
        expect(delete_failed_operations).toHaveLength(0);

        for (const res of delete_successful_operations) {
            expect(res).toHaveLength(initial_num_of_versions);
            for (const single_delete_res of res) {
                expect(single_delete_res.err_message).toBe(undefined);
            }
        }
        const list_res = await nsfs.list_objects({ bucket: bucket }, DUMMY_OBJECT_SDK);
        expect(list_res.objects).toHaveLength(0);
    }, 8000);


    it('nested key - concurrent puts & deletes', async () => {
        const bucket = 'bucket1';
        const key = 'dir3/key3';
        const num_of_concurrency = 5;
        const upload_successful_operations = [];
        const upload_failed_operations = [];
        const delete_successful_operations = [];
        const delete_failed_operations = [];

        for (let i = 0; i < num_of_concurrency; i++) {
            const random_data = Buffer.from(String(crypto_random_string(7)));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK)
                .catch(err => upload_failed_operations.push(err))
                .then(res => {
                    upload_successful_operations.push(res.etag);
                    nsfs.delete_object({ bucket: bucket, key: key, version_id: res.version_id }, DUMMY_OBJECT_SDK)
                        .then(delete_res => delete_successful_operations.push(delete_res))
                        .catch(err => delete_failed_operations.push(err));
                });
        }
        await P.delay(3000);
        expect(upload_successful_operations).toHaveLength(num_of_concurrency);
        expect(upload_failed_operations).toHaveLength(0);
        expect(delete_successful_operations).toHaveLength(num_of_concurrency);
        expect(delete_failed_operations).toHaveLength(0);
    }, 6000);

    it('concurrent puts & list versions', async () => {
        const bucket = 'bucket1';
        const upload_res_arr = [];
        const list_res_arr = [];
        const list_err_arr = [];
        const upload_err_arr = [];
        const initial_num_of_versions = 20;
        const initial_num_of_objects = 20;

        for (let i = 0; i < initial_num_of_objects; i++) {
            const key = 'key_put' + i;
            await _upload_versions(bucket, key, initial_num_of_versions);
        }

        const num_of_concurrency = 20;
        for (let i = 0; i < num_of_concurrency; i++) {
            const key = 'key_put' + i;
            const random_data = Buffer.from(String(crypto_random_string(7)));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK)
                .then(res => upload_res_arr.push(res.etag))
                .catch(err => upload_err_arr.push(err));
            nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK)
                .then(res => list_res_arr.push(res))
                .catch(err => list_err_arr.push(err));
        }
        await P.delay(10000);
        expect(upload_res_arr).toHaveLength(num_of_concurrency);
        expect(list_res_arr).toHaveLength(num_of_concurrency);
        expect(upload_err_arr).toHaveLength(0);
        expect(list_err_arr).toHaveLength(0);
        const versions = await nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK);
        expect(versions.objects).toHaveLength(initial_num_of_versions * initial_num_of_objects + num_of_concurrency);

        const num_of_delete_markers = (versions.objects.filter(version => version.delete_marker === true)).length;
        expect(num_of_delete_markers).toBe(0);
        const num_of_latest_versions = (versions.objects.filter(version => version.is_latest === true)).length;
        expect(num_of_latest_versions).toBe(initial_num_of_objects);
    }, 60000);

    it('concurrent puts & list versions - version id paging', async () => {
        const bucket = 'bucket1';
        const upload_res_arr = [];
        const list_res_arr = [];
        const list_err_arr = [];
        const upload_err_arr = [];
        const initial_num_of_versions = 50;
        const initial_num_of_objects = 50;

        for (let i = 0; i < initial_num_of_objects; i++) {
            const key = 'key_put' + i;
            await _upload_versions(bucket, key, initial_num_of_versions);
        }
        const merged_initial_versions = await get_all_versions(bucket);
        expect(merged_initial_versions).toHaveLength(initial_num_of_objects * initial_num_of_versions);

        const num_of_concurrency = 20;
        for (let i = 0; i < num_of_concurrency; i++) {
            const key = 'key_put' + i;
            const random_data = Buffer.from(String(crypto_random_string(7)));
            const body = buffer_utils.buffer_to_read_stream(random_data);
            nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK)
                .then(res => upload_res_arr.push(res.etag))
                .catch(err => upload_err_arr.push(err));
            nsfs.list_object_versions({ bucket: bucket }, DUMMY_OBJECT_SDK)
                .then(res => list_res_arr.push(res))
                .catch(err => list_err_arr.push(err));
        }
        await P.delay(20000);
        expect(upload_res_arr).toHaveLength(num_of_concurrency);
        expect(list_res_arr).toHaveLength(num_of_concurrency);
        expect(upload_err_arr).toHaveLength(0);
        expect(list_err_arr).toHaveLength(0);

        const merged_versions = await get_all_versions(bucket);
        const expected_num_of_versions = initial_num_of_objects * initial_num_of_versions + num_of_concurrency;
        expect(merged_versions).toHaveLength(expected_num_of_versions);
        const num_of_delete_markers = (merged_versions.filter(version => version.delete_marker === true)).length;
        expect(num_of_delete_markers).toBe(0);
        const num_of_latest_versions = (merged_versions.filter(version => version.is_latest === true)).length;
        expect(num_of_latest_versions).toBe(initial_num_of_objects);
    }, 50000);
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
        const random_data = Buffer.from(String(crypto_random_string(7)));
        const body = buffer_utils.buffer_to_read_stream(random_data);
        const res = await nsfs.upload_object({ bucket: bucket, key: key, source_stream: body }, DUMMY_OBJECT_SDK);
        versions_arr.push({ ...res, key });
    }
    return versions_arr;
}


async function get_all_versions(bucket) {
    let merged_versions = [];
    let key_marker;
    let version_id_marker;
    for (;;) {
        const versions = await nsfs.list_object_versions({ bucket, key_marker, version_id_marker }, DUMMY_OBJECT_SDK);
        merged_versions = merged_versions.concat(versions.objects);
        version_id_marker = versions.next_version_id_marker;
        key_marker = versions.next_marker;
        if (!version_id_marker) break;
    }
    return merged_versions;
}
