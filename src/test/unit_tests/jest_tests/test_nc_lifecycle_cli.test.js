/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const path = require('path');
const config = require('../../../../config');
const fs_utils = require('../../../util/fs_utils');
const { ConfigFS } = require('../../../sdk/config_fs');
const { TMP_PATH, set_nc_config_dir_in_config, TEST_TIMEOUT, exec_manage_cli } = require('../../system_tests/test_utils');
const BucketSpaceFS = require('../../../sdk/bucketspace_fs');
const { TYPES, ACTIONS } = require('../../../manage_nsfs/manage_nsfs_constants');
const NamespaceFS = require('../../../sdk/namespace_fs');
const endpoint_stats_collector = require('../../../sdk/endpoint_stats_collector');
const os_utils = require('../../../util/os_utils');
const { ManageCLIResponse } = require('../../../manage_nsfs/manage_nsfs_cli_responses');
const { ManageCLIError } = require('../../../manage_nsfs/manage_nsfs_cli_errors');
const buffer_utils = require('../../../util/buffer_utils');
const crypto = require('crypto');
const NsfsObjectSDK = require('../../../sdk/nsfs_object_sdk');
const nb_native = require('../../../util/nb_native');

const new_umask = process.env.NOOBAA_ENDPOINT_UMASK || 0o000;
const old_umask = process.umask(new_umask);
console.log('test_nc_lifecycle_cli: replacing old umask: ', old_umask.toString(8), 'with new umask: ', new_umask.toString(8));

const config_root = path.join(TMP_PATH, 'config_root_nc_lifecycle');
const root_path = path.join(TMP_PATH, 'root_path_nc_lifecycle/');
const config_fs = new ConfigFS(config_root);

function make_dummy_object_sdk(account_json) {
    return {
        requesting_account: account_json
    };
}

describe('noobaa cli - lifecycle - lock check', () => {
    const original_lifecycle_run_time = config.NC_LIFECYCLE_RUN_TIME;
    const original_lifecycle_run_delay = config.NC_LIFECYCLE_RUN_DELAY_LIMIT_MINS;

    beforeAll(async () => {
        await fs_utils.create_fresh_path(config_root, 0o777);
        set_nc_config_dir_in_config(config_root);
        await fs_utils.create_fresh_path(root_path, 0o777);
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

    it('lifecycle_cli - change run time to now - 2 locks - the second should fail ', async () => {
        await config_fs.create_config_json_file(JSON.stringify({ NC_LIFECYCLE_RUN_TIME: date_to_run_time_format()}));
        const res1 = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', config_root }, undefined, undefined);
        const res2 = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', config_root }, undefined, undefined);
        await config_fs.delete_config_json_file();
        const parsed_res1 = JSON.parse(res1).response;
        expect(parsed_res1.code).toBe(ManageCLIResponse.LifecycleSuccessful.code);
        expect(parsed_res1.message).toBe(ManageCLIResponse.LifecycleSuccessful.message);
        const parsed_res2 = JSON.parse(res2).response;
        expect(parsed_res2.code).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.code);
        expect(parsed_res2.message).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.message);
    });

    it('lifecycle_cli - no run time change - 2 locks - both should fail ', async () => {
        const res1 = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', config_root }, undefined, undefined);
        const res2 = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', config_root }, undefined, undefined);
        const parsed_res1 = JSON.parse(res1).response;
        expect(parsed_res1.code).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.code);
        expect(parsed_res1.message).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.message);
        const parsed_res2 = JSON.parse(res2).response;
        expect(parsed_res2.code).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.code);
        expect(parsed_res2.message).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.message);
    });

    it('lifecycle_cli - change run time to 4 minutes ago - should fail ', async () => {
        const lifecyle_run_date = new Date();
        lifecyle_run_date.setMinutes(lifecyle_run_date.getMinutes() - 4);
        await config_fs.create_config_json_file(JSON.stringify({
            NC_LIFECYCLE_RUN_TIME: date_to_run_time_format(lifecyle_run_date)
        }));
        const res = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', config_root }, undefined, undefined);
        await config_fs.delete_config_json_file();
        const parsed_res = JSON.parse(res).response;
        expect(parsed_res.code).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.code);
        expect(parsed_res.message).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.message);
    });

    it('lifecycle_cli - change run time to 1 minutes ago - should succeed ', async () => {
        const lifecyle_run_date = new Date();
        lifecyle_run_date.setMinutes(lifecyle_run_date.getMinutes() - 1);
        await config_fs.create_config_json_file(JSON.stringify({
            NC_LIFECYCLE_RUN_TIME: date_to_run_time_format(lifecyle_run_date)
        }));
        const res = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', config_root }, undefined, undefined);
        await config_fs.delete_config_json_file();
        const parsed_res = JSON.parse(res).response;
        expect(parsed_res.code).toBe(ManageCLIResponse.LifecycleSuccessful.code);
        expect(parsed_res.message).toBe(ManageCLIResponse.LifecycleSuccessful.message);
    });

    it('lifecycle_cli - change run time to 1 minute in the future - should fail ', async () => {
        const lifecyle_run_date = new Date();
        lifecyle_run_date.setMinutes(lifecyle_run_date.getMinutes() + 1);
        await config_fs.create_config_json_file(JSON.stringify({
            NC_LIFECYCLE_RUN_TIME: date_to_run_time_format(lifecyle_run_date)
        }));
        const res = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', config_root }, undefined, undefined);
        await config_fs.delete_config_json_file();
        const parsed_res = JSON.parse(res).response;
        expect(parsed_res.code).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.code);
        expect(parsed_res.message).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.message);
    });
});

describe('noobaa cli - lifecycle', () => {
    const bucketspace_fs = new BucketSpaceFS({ config_root }, undefined);
    const test_bucket = 'test-bucket';
    const test_bucket_path = `${root_path}/${test_bucket}`;
    const test_bucket2 = 'test-bucket2';
    const test_bucket2_path = `${root_path}/${test_bucket2}`;
    const test_key1 = 'test_key1';
    const test_key2 = 'test_key2';
    const prefix = 'test/';
    const test_prefix_key = `${prefix}/test_key1`;
    const account_options1 = {uid: 2002, gid: 2002, new_buckets_path: root_path, name: 'user2', config_root, allow_bucket_creation: 'true'};
    let dummy_sdk;
    let nsfs;

    beforeAll(async () => {
        await fs_utils.create_fresh_path(config_root, 0o777);
        set_nc_config_dir_in_config(config_root);
        await fs_utils.create_fresh_path(root_path, 0o777);
        const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, account_options1);
        const json_account = JSON.parse(res).response.reply;
        console.log(json_account);
        dummy_sdk = make_dummy_object_sdk(json_account);
        await bucketspace_fs.create_bucket({ name: test_bucket }, dummy_sdk);
        await bucketspace_fs.create_bucket({ name: test_bucket2 }, dummy_sdk);
        const bucket_json = await config_fs.get_bucket_by_name(test_bucket, undefined);

        nsfs = new NamespaceFS({
            bucket_path: test_bucket_path,
            bucket_id: bucket_json._id,
            namespace_resource_id: undefined,
            access_mode: undefined,
            versioning: undefined,
            force_md5_etag: false,
            stats: endpoint_stats_collector.instance(),
        });

    });

    afterEach(async () => {
        await bucketspace_fs.delete_bucket_lifecycle({ name: test_bucket });
        await bucketspace_fs.delete_bucket_lifecycle({ name: test_bucket2 });
        await fs_utils.create_fresh_path(test_bucket_path);
    });

    afterAll(async () => {
        await fs_utils.folder_delete(test_bucket_path);
        await fs_utils.folder_delete(test_bucket2_path);
        await fs_utils.folder_delete(root_path);
        await fs_utils.folder_delete(config_root);
    }, TEST_TIMEOUT);

    it('lifecycle_cli - abort mpu by number of days ', async () => {
        const lifecycle_rule = [
                {
                "id": "abort mpu after 3 days",
                "status": "Enabled",
                "filter": {"prefix": ""},
                "abort_incomplete_multipart_upload": {
                    "days_after_initiation": 3
                }
            }
        ];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        const res = await nsfs.create_object_upload({ key: test_key1, bucket: test_bucket }, dummy_sdk);
        await nsfs.create_object_upload({ key: test_key1, bucket: test_bucket }, dummy_sdk);
        await update_mpu_mtime(res.obj_id);
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const mpu_list = await nsfs.list_uploads({ bucket: test_bucket }, dummy_sdk);
        expect(mpu_list.objects.length).toBe(1); //removed the mpu that was created 5 days ago
    });

    it('lifecycle_cli - abort mpu by prefix and number of days ', async () => {
        const lifecycle_rule = [
                {
                "id": "abort mpu after 3 days for prefix",
                "status": "Enabled",
                "filter": {"prefix": prefix},
                "abort_incomplete_multipart_upload": {
                    "days_after_initiation": 3
                }
            }
        ];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        let res = await nsfs.create_object_upload({ key: test_key1, bucket: test_bucket }, dummy_sdk);
        await update_mpu_mtime(res.obj_id);
        res = await nsfs.create_object_upload({ key: test_prefix_key, bucket: test_bucket }, dummy_sdk);
        await update_mpu_mtime(res.obj_id);
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const mpu_list = await nsfs.list_uploads({ bucket: test_bucket }, dummy_sdk);
        expect(mpu_list.objects.length).toBe(1); //only removed test_prefix_key
    });

    it('lifecycle_cli - abort mpu by tags ', async () => {
        const tag_set = [{key: "key1", value: "val1"}, {key: "key2", value: "val2"}];
        const different_tag_set = [{key: "key5", value: "val5"}];
        const lifecycle_rule = [
                {
                "id": "abort mpu after 3 days for tags",
                "status": "Enabled",
                "filter": {
                    "prefix": '',
                    "tags": tag_set
                },
                "abort_incomplete_multipart_upload": {
                    "days_after_initiation": 3
                }
            }
        ];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        let res = await nsfs.create_object_upload(
            {key: test_key1, bucket: test_bucket, tagging: [...tag_set, ...different_tag_set]},
            dummy_sdk);
        await update_mpu_mtime(res.obj_id);
        res = await nsfs.create_object_upload({ key: test_key1, bucket: test_bucket, tagging: different_tag_set}, dummy_sdk);
        await update_mpu_mtime(res.obj_id);
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const mpu_list = await nsfs.list_uploads({ bucket: test_bucket }, dummy_sdk);
        expect(mpu_list.objects.length).toBe(1);
    });

    it('lifecycle_cli - expiration rule - by number of days ', async () => {
        const lifecycle_rule = [
                {
                "id": "expiration after 3 days",
                "status": "Enabled",
                "filter": {
                    "prefix": '',
                },
                "expiration": {
                    "days": 3
                }
            }
        ];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        create_object(test_bucket, test_key1, 100, true);
        create_object(test_bucket, test_key2, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await nsfs.list_objects({bucket: test_bucket}, dummy_sdk);
        expect(object_list.objects.length).toBe(1);
        expect(object_list.objects[0].key).toBe(test_key2);
    });

    it('lifecycle_cli - expiration rule - by date - after the date ', async () => {
        const date = new Date();
        date.setDate(date.getDate() - 1); // yesterday
        const lifecycle_rule = [
                {
                "id": "expiration by date",
                "status": "Enabled",
                "filter": {
                    "prefix": '',
                },
                "expiration": {
                    "date": date.getTime()
                }
            }
        ];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        create_object(test_bucket, test_key1, 100, false);
        create_object(test_bucket, test_key2, 100, false);

        await update_file_mtime(path.join(test_bucket_path, test_key1));
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await nsfs.list_objects({bucket: test_bucket}, dummy_sdk);
        expect(object_list.objects.length).toBe(0); //should delete all objects
    });

    it('lifecycle_cli - expiration rule - by date - before the date ', async () => {
        const date = new Date();
        date.setDate(date.getDate() + 1); // tommorow
        const lifecycle_rule = [
                {
                "id": "expiration by date",
                "status": "Enabled",
                "filter": {
                    "prefix": '',
                },
                "expiration": {
                    "date": date.getTime()
                }
            }
        ];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        create_object(test_bucket, test_key1, 100, false);
        create_object(test_bucket, test_key2, 100, false);

        await update_file_mtime(path.join(test_bucket_path, test_key1));
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await nsfs.list_objects({bucket: test_bucket}, dummy_sdk);
        expect(object_list.objects.length).toBe(2); //should not delete any entry
    });

    it('lifecycle_cli - expiration rule - with prefix ', async () => {
        const date = new Date();
        date.setDate(date.getDate() - 1); // yesterday
        const lifecycle_rule = [
                {
                "id": "expiration by prefix",
                "status": "Enabled",
                "filter": {
                    "prefix": prefix,
                },
                "expiration": {
                    "date": date.getTime()
                }
            }
        ];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        create_object(test_bucket, test_key1, 100, true);
        create_object(test_bucket, test_prefix_key, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await nsfs.list_objects({bucket: test_bucket}, dummy_sdk);
        expect(object_list.objects.length).toBe(1);
        expect(object_list.objects[0].key).toBe(test_key1);
    });

    it('lifecycle_cli - expiration rule - filter by tags ', async () => {
        const tag_set = [{key: "key1", value: "val1"}, {key: "key2", value: "val2"}];
        const different_tag_set = [{key: "key5", value: "val5"}];
        const lifecycle_rule = [
                {
                "id": "expiration after 3 days with tags",
                "status": "Enabled",
                "filter": {
                    "prefix": '',
                    "tags": tag_set
                },
                "expiration": {
                    "days": 3
                }
            }
        ];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        const test_key1_tags = [...tag_set, ...different_tag_set];
        create_object(test_bucket, test_key1, 100, true, test_key1_tags);
        create_object(test_bucket, test_key2, 100, true, different_tag_set);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await nsfs.list_objects({bucket: test_bucket}, dummy_sdk);
        expect(object_list.objects.length).toBe(1);
        expect(object_list.objects[0].key).toBe(test_key2);
    });

    it('lifecycle_cli - expiration rule - filter by size ', async () => {
        const lifecycle_rule = [
                {
                "id": "expiration after 3 days with tags",
                "status": "Enabled",
                "filter": {
                    "prefix": '',
                    "object_size_greater_than": 30,
                    "object_size_less_than": 90
                },
                "expiration": {
                    "days": 3
                }
            }
        ];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        create_object(test_bucket, test_key1, 100, true);
        create_object(test_bucket, test_key2, 80, true);
        create_object(test_bucket, test_prefix_key, 20, true);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await nsfs.list_objects({bucket: test_bucket}, dummy_sdk);
        expect(object_list.objects.length).toBe(2);
        object_list.objects.forEach(element => {
            expect(element.key).not.toBe(test_key2);
        });
    });

    async function create_object(bucket, key, size, is_old, tagging) {
        const data = crypto.randomBytes(size);
        await nsfs.upload_object({
            bucket,
            key,
            source_stream: buffer_utils.buffer_to_read_stream(data),
            size,
            tagging
        }, dummy_sdk);
        if (is_old) await update_file_mtime(path.join(root_path, bucket, key));
    }

    async function update_mpu_mtime(obj_id) {
        const mpu_path = nsfs._mpu_path({obj_id});
        return await update_file_mtime(mpu_path);
    }

});


describe('noobaa cli lifecycle - timeout check', () => {
    const original_lifecycle_timeout = config.NC_LIFECYCLE_TIMEOUT_MS;

    beforeAll(async () => {
        await fs_utils.create_fresh_path(config_root, 0o777);
        set_nc_config_dir_in_config(config_root);
        await fs_utils.create_fresh_path(root_path, 0o777);
    });

    afterEach(async () => {
        config.NC_LIFECYCLE_TIMEOUT_MS = original_lifecycle_timeout;
        await fs_utils.folder_delete(config.NC_LIFECYCLE_LOGS_DIR);
    });

    afterAll(async () => {
        await fs_utils.folder_delete(root_path);
        await fs_utils.folder_delete(config_root);
    }, TEST_TIMEOUT);

    it('lifecycle_cli - change timeout to 1 ms - should fail', async () => {
        await config_fs.create_config_json_file(JSON.stringify({ NC_LIFECYCLE_TIMEOUT_MS: 1 }));
        const res1 = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true, undefined);
        await config_fs.delete_config_json_file();
        const parsed_res1 = JSON.parse(res1.stdout).error;
        expect(parsed_res1.code).toBe(ManageCLIError.LifecycleWorkerReachedTimeout.code);
        expect(parsed_res1.message).toBe(ManageCLIError.LifecycleWorkerReachedTimeout.message);
    });
});

describe('noobaa cli - lifecycle batching', () => {
    const bucketspace_fs = new BucketSpaceFS({ config_root }, undefined);
    const test_bucket = 'test-bucket';
    const test_bucket_path = `${root_path}/${test_bucket}`;
    const test_key1 = 'test_key1';
    const test_key2 = 'test_key2';
    const account_options1 = {uid: 2002, gid: 2002, new_buckets_path: root_path, name: 'user2', config_root, allow_bucket_creation: 'true'};
    let object_sdk;
    const tmp_lifecycle_logs_dir_path = path.join(TMP_PATH, 'test_lifecycle_logs');

    beforeAll(async () => {
        await fs_utils.create_fresh_path(config_root, 0o777);
        set_nc_config_dir_in_config(config_root);
        await fs_utils.create_fresh_path(root_path, 0o777);
        const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, account_options1);
        const json_account = JSON.parse(res).response.reply;
        console.log(json_account);
        object_sdk = new NsfsObjectSDK('', config_fs, json_account, "DISABLED", config_fs.config_root, undefined);
        object_sdk.requesting_account = json_account;
        await object_sdk.create_bucket({ name: test_bucket });
        config.NC_LIFECYCLE_LOGS_DIR = tmp_lifecycle_logs_dir_path;
        config.NC_LIFECYCLE_LIST_BATCH_SIZE = 2;
        config.NC_LIFECYCLE_BUCKET_BATCH_SIZE = 5;
    });

    beforeEach(async () => {
        await config_fs.create_config_json_file(JSON.stringify({ NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path }));
    });

    afterEach(async () => {
        await bucketspace_fs.delete_bucket_lifecycle({ name: test_bucket });
        await fs_utils.create_fresh_path(test_bucket_path);
        fs_utils.folder_delete(tmp_lifecycle_logs_dir_path);
        await config_fs.delete_config_json_file();
    });

    it("lifecycle batching - no lifecycle rules", async () => {
        const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
        expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
    });

    it("lifecycle batching - with lifecycle rule, one batch", async () => {
        const lifecycle_rule = [
            {
            "id": "expiration after 3 days with tags",
            "status": "Enabled",
            "filter": {
                "prefix": '',
            },
            "expiration": {
                "days": 3
            }
        }];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        create_object(object_sdk, test_bucket, test_key1, 100, true);
        create_object(object_sdk, test_bucket, test_key2, 100, true);
        const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
        expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
        Object.values(parsed_res_latest_lifecycle.response.reply.buckets_statuses).forEach(bucket_stat => {
            expect(bucket_stat.state.is_finished).toBe(true);
            Object.values(bucket_stat.rules_statuses).forEach(rule_status => {
                expect(rule_status.state.is_finished).toBe(true);
            });
        });
    });

    it("lifecycle batching - with lifecycle rule, no expire statement", async () => {
        const lifecycle_rule = [
            {
            "id": "expiration after 3 days with tags",
            "status": "Enabled",
            "filter": {
                "prefix": '',
            },
            "abort_incomplete_multipart_upload": {
                "days_after_initiation": 3
            }
        }];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        await object_sdk.create_object_upload({ key: test_key1, bucket: test_bucket });
        await object_sdk.create_object_upload({ key: test_key2, bucket: test_bucket });
        const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
        expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
        Object.values(parsed_res_latest_lifecycle.response.reply.buckets_statuses).forEach(bucket_stat => {
            expect(bucket_stat.state.is_finished).toBe(true);
        });
    });

    it("lifecycle batching - with lifecycle rule, multiple list batches, one bucket batch", async () => {
        const lifecycle_rule = [
            {
            "id": "expiration after 3 days with tags",
            "status": "Enabled",
            "filter": {
                "prefix": '',
            },
            "expiration": {
                "days": 3
            }
        }];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        create_object(object_sdk, test_bucket, test_key1, 100, true);
        create_object(object_sdk, test_bucket, test_key2, 100, true);
        create_object(object_sdk, test_bucket, "key3", 100, true);
        create_object(object_sdk, test_bucket, "key4", 100, true);
        create_object(object_sdk, test_bucket, "key5", 100, true);
        const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
        expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
        expect(object_list.objects.length).toBe(0);
    });

    it("lifecycle batching - with lifecycle rule, multiple list batches, multiple bucket batches", async () => {
        const lifecycle_rule = [
            {
            "id": "expiration after 3 days with tags",
            "status": "Enabled",
            "filter": {
                "prefix": '',
            },
            "expiration": {
                "days": 3
            }
        }];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        create_object(object_sdk, test_bucket, test_key1, 100, true);
        create_object(object_sdk, test_bucket, test_key2, 100, true);
        create_object(object_sdk, test_bucket, "key3", 100, true);
        create_object(object_sdk, test_bucket, "key4", 100, true);
        create_object(object_sdk, test_bucket, "key5", 100, true);
        create_object(object_sdk, test_bucket, "key6", 100, true);
        create_object(object_sdk, test_bucket, "key7", 100, true);
        const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
        expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
        expect(object_list.objects.length).toBe(0);
    });

    it("lifecycle batching - with lifecycle rule, multiple list batches, one bucket batch", async () => {
        const lifecycle_rule = [
            {
            "id": "expiration after 3 days with tags",
            "status": "Enabled",
            "filter": {
                "prefix": '',
            },
            "expiration": {
                "days": 3
            }
        }];
        await bucketspace_fs.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        create_object(object_sdk, test_bucket, test_key1, 100, true);
        create_object(object_sdk, test_bucket, test_key2, 100, true);

        await config_fs.update_config_json_file(JSON.stringify({
            NC_LIFECYCLE_TIMEOUT_MS: 1,
            NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path
        }));
        await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true, undefined);

        const lifecycle_log_entries = await nb_native().fs.readdir(config_fs.fs_context, tmp_lifecycle_logs_dir_path);
        expect(lifecycle_log_entries.length).toBe(1);
        const log_file_path = path.join(tmp_lifecycle_logs_dir_path, lifecycle_log_entries[0].name);
        const lifecycle_log_json = await config_fs.get_config_data(log_file_path, {silent_if_missing: true});
        expect(lifecycle_log_json.state.is_finished).toBe(false);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
        expect(object_list.objects.length).not.toBe(0);
    });

    //TODO should move outside scope and change also in lifecycle tests. already done in non current lifecycle rule PR
    async function create_object(sdk, bucket, key, size, is_old, tagging) {
        const data = crypto.randomBytes(size);
        const res = await sdk.upload_object({
            bucket,
            key,
            source_stream: buffer_utils.buffer_to_read_stream(data),
            size,
            tagging
        });
        if (is_old) await update_file_mtime(path.join(root_path, bucket, key));
        return res;
    }
});


/**
 * update_file_mtime updates the mtime of the target path
 * @param {String} target_path
 * @returns {Promise<Void>}
 */
async function update_file_mtime(target_path) {
    const update_file_mtime_cmp = os_utils.IS_MAC ? `touch -t $(date -v -5d +"%Y%m%d%H%M.%S") ${target_path}` : `touch -d "5 days ago" ${target_path}`;
    await os_utils.exec(update_file_mtime_cmp, { return_stdout: true });
}

/**
 * date_to_run_time_format coverts a date to run time format HH:MM
 * @param {Date} date
 * @returns {String}
 */
function date_to_run_time_format(date = new Date()) {
    return date.getHours() + ':' + date.getMinutes();
}
