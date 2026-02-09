/* Copyright (C) 2016 NooBaa */
'use strict';
/* eslint-disable max-lines-per-function */

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const path = require('path');
const crypto = require('crypto');
const config = require('../../../../../config');
const fs_utils = require('../../../../util/fs_utils');
const NamespaceFS = require('../../../../sdk/namespace_fs');
const buffer_utils = require('../../../../util/buffer_utils');
const lifecycle_utils = require('../../../../util/lifecycle_utils');
const endpoint_stats_collector = require('../../../../sdk/endpoint_stats_collector');
const { TMP_PATH, set_nc_config_dir_in_config, TEST_TIMEOUT } = require('../../../system_tests/test_utils');


const config_root = path.join(TMP_PATH, 'config_root_nc_lifecycle');
const root_path = path.join(TMP_PATH, 'root_path_nc_lifecycle/');
const bucket_name = 'lifecycle_bucket';
const bucket_path = path.join(root_path, bucket_name);
const dummy_object_sdk = make_dummy_object_sdk();
const key = 'obj1.txt';
const data = crypto.randomBytes(100);

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
            return undefined;
        },
        read_bucket_full_info(name) {
            return {};
        }
    };
}

const nsfs = new NamespaceFS({
    bucket_path: bucket_path,
    bucket_id: '1',
    namespace_resource_id: undefined,
    access_mode: undefined,
    versioning: undefined,
    force_md5_etag: false,
    stats: endpoint_stats_collector.instance(),
});

describe('delete_multiple_objects + filter', () => {
    const original_lifecycle_run_time = config.NC_LIFECYCLE_RUN_TIME;
    const original_lifecycle_run_delay = config.NC_LIFECYCLE_RUN_DELAY_LIMIT_MINS;

    beforeAll(async () => {
        await fs_utils.create_fresh_path(config_root, 0o777);
        set_nc_config_dir_in_config(config_root);
        await fs_utils.create_fresh_path(root_path, 0o777);
        await fs_utils.create_fresh_path(bucket_path, 0o777);
    });

    beforeEach(async () => {
        await fs_utils.create_fresh_path(root_path, 0o777);
        await fs_utils.create_fresh_path(bucket_path, 0o777);
    });

    afterEach(async () => {
        config.NC_LIFECYCLE_RUN_TIME = original_lifecycle_run_time;
        config.NC_LIFECYCLE_RUN_DELAY_LIMIT_MINS = original_lifecycle_run_delay;
        await fs_utils.folder_delete(config.NC_LIFECYCLE_LOGS_DIR);
        await fs_utils.folder_delete(config_root);
    });

    afterAll(async () => {
        await fs_utils.folder_delete(root_path);
        await fs_utils.folder_delete(config_root);
    }, TEST_TIMEOUT);

    describe('filter should fail - versioning DISABLED', () => {

        it('delete_multiple_objects - filter should fail on wrong prefix - versioning DISABLED bucket', async () => {
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { prefix: 'd' }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects - filter should fail on wrong object_size_less_than - versioning DISABLED bucket', async () => {
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_less_than: 99 }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects - filter should fail on wrong object_size_greater_than - versioning DISABLED bucket', async () => {
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_greater_than: 101 }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects - filter should fail on wrong tags - versioning DISABLED bucket', async () => {
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { tags: [{ key: 'a', value: 'b'}] }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects - filter should fail on expiration - versioning DISABLED bucket', async () => {
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ expiration: 5 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });
    });

    describe('filter should pass - versioning DISABLED', () => {

        it('delete_multiple_objects - filter should pass on wrong prefix - versioning DISABLED bucket', async () => {
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { prefix: 'ob' }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res);
        });

        it('delete_multiple_objects - filter should pass on wrong object_size_less_than - versioning DISABLED bucket', async () => {
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_less_than: 101 }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res);
        });

        it('delete_multiple_objects - filter should pass on wrong object_size_greater_than - versioning DISABLED bucket', async () => {
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_greater_than: 1 }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res);
        });

        it('delete_multiple_objects - filter should pass on wrong tags - versioning DISABLED bucket', async () => {
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const tagging = [{ key: 'a', value: 'b' }];
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer, tagging }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { tags: tagging }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res);
        });

        it('delete_multiple_objects - filter should pass on expiration - versioning DISABLED bucket', async () => {
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res);
        });
    });

    describe('filter should fail - versioning ENABLED', () => {

        it('delete_multiple_objects - filter should fail on wrong prefix - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { prefix: 'd' }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects - filter should fail on wrong object_size_less_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_less_than: 99 }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects - filter should fail on wrong object_size_greater_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_greater_than: 101 }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects - filter should fail on wrong tags - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { tags: [{ key: 'a', value: 'b'}] }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects - filter should fail on expiration - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ expiration: 5 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });
    });

    describe('filter should pass - versioning ENABLED', () => {

        it('delete_multiple_objects - filter should pass on wrong prefix - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { prefix: 'ob' }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res, { should_create_a_delete_marker: true });
        });

        it('delete_multiple_objects - filter should pass on wrong object_size_less_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_less_than: 101 }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res, { should_create_a_delete_marker: true });
        });

        it('delete_multiple_objects - filter should pass on wrong object_size_greater_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_greater_than: 1 }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res, { should_create_a_delete_marker: true });
        });

        it('delete_multiple_objects - filter should pass on wrong tags - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const tagging = [{ key: 'a', value: 'b' }];
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer, tagging }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { tags: tagging }, expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res, { should_create_a_delete_marker: true });
        });

        it('delete_multiple_objects - filter should pass on expiration - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ expiration: 0 });
            const delete_res = await nsfs.delete_multiple_objects({ objects: [{ key }], filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res, { should_create_a_delete_marker: true });
        });
    });

    describe('delete multiple objects + version_id + version is latest - filter should fail - versioning ENABLED', () => {

        it('delete_multiple_objects + version_id + version is latest - filter should fail on wrong prefix - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const upload_res = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { prefix: 'd' }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects + version_id + version is latest - filter should fail on wrong object_size_less_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const upload_res = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_less_than: 99 }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects + version_id + version is latest - filter should fail on wrong object_size_greater_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const upload_res = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_greater_than: 101 }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects + version_id + version is latest - filter should fail on wrong tags - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const upload_res = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { tags: [{ key: 'a', value: 'b'}] }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects + version_id + version is latest - filter should fail on expiration - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const upload_res = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ expiration: 5 });
            const objects_to_delete = [{ key, version_id: upload_res.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });
    });


    describe('filter should pass + version_id + version is latest - versioning ENABLED', () => {

        it('delete_multiple_objects + version_id + version is latest - filter should pass on prefix - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const upload_res = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { prefix: 'ob' }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res);
        });

        it('delete_multiple_objects + version_id + version is latest - filter should pass on object_size_less_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const upload_res = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_less_than: 101 }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res);
        });

        it('delete_multiple_objects + version_id + version is latest - filter should pass on object_size_greater_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const upload_res = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_greater_than: 1 }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res);
        });

        it('delete_multiple_objects + version_id + version is latest - filter should pass on tags - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const tagging = [{ key: 'a', value: 'b' }];
            const upload_res = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer, tagging },
                dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { tags: tagging }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res);
        });

        it('delete_multiple_objects + version_id + version is latest - filter should pass on expiration - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer = buffer_utils.buffer_to_read_stream(data);
            const upload_res = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res);
        });
    });

    describe('delete multiple objects + version_id + version is not latest - filter should fail - versioning ENABLED', () => {

        it('delete_multiple_objects + version_id + version is not latest - filter should fail on wrong prefix - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            const data_buffer2 = buffer_utils.buffer_to_read_stream(data);
            const upload_res1 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer2 }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { prefix: 'd' }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res1.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects + version_id + version is not latest - filter should fail on wrong object_size_less_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            const data_buffer2 = buffer_utils.buffer_to_read_stream(data);
            const upload_res1 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer2 }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_less_than: 99 }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res1.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects + version_id + version is not latest - filter should fail on wrong object_size_greater_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            const data_buffer2 = buffer_utils.buffer_to_read_stream(data);
            const upload_res1 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer2 }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_greater_than: 101 }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res1.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects + version_id + version is not latest - filter should fail on wrong tags - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            const data_buffer2 = buffer_utils.buffer_to_read_stream(data);
            const upload_res1 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer2 }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { tags: [{ key: 'a', value: 'b'}] }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res1.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });

        it('delete_multiple_objects + version_id + version is not latest - filter should fail on expiration - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            const data_buffer2 = buffer_utils.buffer_to_read_stream(data);
            const upload_res1 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer2 }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ expiration: 5 });
            const objects_to_delete = [{ key, version_id: upload_res1.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res);
        });
    });

    describe('filter should pass + version_id + version is not latest - versioning ENABLED', () => {

        it('delete_multiple_objects + version_id + version is not latest - filter should pass on prefix - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            const data_buffer2 = buffer_utils.buffer_to_read_stream(data);
            const upload_res1 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            const upload_res2 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer2 }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { prefix: 'ob' }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res1.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res, { new_latest_version: upload_res2.version_id});
        });

        it('delete_multiple_objects + version_id + version is not latest - filter should pass on object_size_less_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            const data_buffer2 = buffer_utils.buffer_to_read_stream(data);
            const upload_res1 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            const upload_res2 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer2 }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_less_than: 101 }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res1.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res, { new_latest_version: upload_res2.version_id});
        });

        it('delete_multiple_objects + version_id + version is not latest - filter should pass on object_size_greater_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            const data_buffer2 = buffer_utils.buffer_to_read_stream(data);
            const upload_res1 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            const upload_res2 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer2 }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_greater_than: 1 }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res1.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res, { new_latest_version: upload_res2.version_id});
        });

        it('delete_multiple_objects + version_id + version is not latest - filter should pass on tags - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const tagging = [{ key: 'a', value: 'b' }];
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            const data_buffer2 = buffer_utils.buffer_to_read_stream(data);
            const upload_res1 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            const upload_res2 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer2 }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { tags: tagging }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res1.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res, { new_latest_version: upload_res2.version_id});
        });

        it('delete_multiple_objects + version_id + version is not latest - filter should pass on expiration - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            const data_buffer2 = buffer_utils.buffer_to_read_stream(data);
            const upload_res1 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            const upload_res2 = await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer2 }, dummy_object_sdk);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ expiration: 0 });
            const objects_to_delete = [{ key, version_id: upload_res1.version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deleted(delete_res, { new_latest_version: upload_res2.version_id});
        });
    });

    describe('delete multiple objects + version_id + version is latest delete_marker - filter should fail - versioning ENABLED', () => {

        it('delete_multiple_objects + version_id + version is latest delete_marker - filter should fail on wrong prefix - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            const delete_res1 = await nsfs.delete_object({ bucket: bucket_name, key: key }, dummy_object_sdk);
            expect(delete_res1.created_delete_marker).toBe(true);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { prefix: 'd' }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: delete_res1.created_version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res, { latest_delete_marker: true });
        });

        it('delete_multiple_objects + version_id + version is latest delete_marker - filter should fail on wrong object_size_greater_than - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            const delete_res1 = await nsfs.delete_object({ bucket: bucket_name, key: key }, dummy_object_sdk);
            expect(delete_res1.created_delete_marker).toBe(true);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { object_size_greater_than: 101 }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: delete_res1.created_version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res, { latest_delete_marker: true });
        });

        it('delete_multiple_objects + version_id + version is latest delete_marker - filter should fail on wrong tags - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            const delete_res1 = await nsfs.delete_object({ bucket: bucket_name, key: key }, dummy_object_sdk);
            expect(delete_res1.created_delete_marker).toBe(true);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ filter: { tags: [{ key: 'a', value: 'b' }] }, expiration: 0 });
            const objects_to_delete = [{ key, version_id: delete_res1.created_version_id }];
            const delete_res = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res, { latest_delete_marker: true });
        });

        it('delete_multiple_objects + version_id + version is latest delete_marker - filter should fail on expiration - versioning ENABLED bucket', async () => {
            nsfs.versioning = 'ENABLED';
            const data_buffer1 = buffer_utils.buffer_to_read_stream(data);
            await nsfs.upload_object({ bucket: bucket_name, key: key, source_stream: data_buffer1 }, dummy_object_sdk);
            const delete_res1 = await nsfs.delete_object({ bucket: bucket_name, key: key }, dummy_object_sdk);
            expect(delete_res1.created_delete_marker).toBe(true);
            const filter_func = lifecycle_utils.build_lifecycle_filter({ expiration: 5 });
            const objects_to_delete = [{ key, version_id: delete_res1.created_version_id }];
            const delete_res2 = await nsfs.delete_multiple_objects({ objects: objects_to_delete, filter_func }, dummy_object_sdk);
            await assert_object_deletion_failed(delete_res2, { latest_delete_marker: true });
        });
    });
});

// , { deleted_delete_marker: true, new_latest_version: upload_res1.version_id }
/**
 * assert_object_deletion_failed asserts that delete_res contains an error and that the file still exists
 * @param {Object} delete_res 
 * @param {{latest_delete_marker?: boolean}} [options]
 * @returns {Promise<Void>}
 */
async function assert_object_deletion_failed(delete_res, { latest_delete_marker = false } = {}) {
    expect(delete_res.length).toBe(1);
    expect(delete_res[0].err_code).toBeDefined();
    expect(delete_res[0].err_message).toBe('file_matches_filter lifecycle - filter on file returned false ' + key);
    // file was not deleted
    if (latest_delete_marker) {
        await expect(nsfs.read_object_md({ bucket: bucket_name, key: key }, dummy_object_sdk)).rejects.toThrow('No such file or directory');
    } else {
        const object_metadata = await nsfs.read_object_md({ bucket: bucket_name, key: key }, dummy_object_sdk);
        expect(object_metadata.key).toBe(key);
    }
}

/**
 * assert_object_deleted asserts that delete_res contains the deleted key and that the file was deleted
 * @param {Object} delete_res 
 * @param {{should_create_a_delete_marker?: Boolean, 
 * should_delete_a_delete_marker?: Boolean,
 * new_latest_version?: String
 * }} [options]
 * @returns {Promise<Void>}
 */
async function assert_object_deleted(delete_res, options = {}) {
    const { should_create_a_delete_marker = false, should_delete_a_delete_marker = false, new_latest_version = undefined } = options;
    expect(delete_res.length).toBe(1);
    if (nsfs.versioning === 'ENABLED') {
        if (should_create_a_delete_marker) {
            expect(delete_res[0].created_delete_marker).toBe(true);
            expect(delete_res[0].created_version_id).toBeDefined();
        } else if (should_delete_a_delete_marker) {
            expect(delete_res[0].deleted_delete_marker).toBeDefined();
        } else {
            expect(delete_res[0].created_delete_marker).toBeUndefined();
            expect(delete_res[0].deleted_delete_marker).toBeUndefined();
            expect(delete_res[0].created_version_id).toBeUndefined();
        }
    } else {
        expect(delete_res[0].key).toBe(key);
    }
    // file was deleted
    if (new_latest_version) {
        const actual_latest_version = await nsfs.read_object_md({ bucket: bucket_name, key: key }, dummy_object_sdk);
        expect(new_latest_version).toBe(actual_latest_version.version_id);
    } else {
        await expect(nsfs.read_object_md({ bucket: bucket_name, key: key }, dummy_object_sdk)).rejects.toThrow('No such file or directory');
    }
}
