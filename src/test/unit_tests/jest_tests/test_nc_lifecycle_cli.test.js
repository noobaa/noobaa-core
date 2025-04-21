/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const path = require('path');
const fs = require('fs');
const config = require('../../../../config');
const fs_utils = require('../../../util/fs_utils');
const { ConfigFS } = require('../../../sdk/config_fs');
const { TMP_PATH, set_nc_config_dir_in_config, TEST_TIMEOUT, exec_manage_cli, create_system_json } = require('../../system_tests/test_utils');
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
const account_options1 = { uid: 2002, gid: 2002, new_buckets_path: root_path, name: 'user2', config_root, allow_bucket_creation: 'true' };
const test_bucket = 'test-bucket';
const test_bucket1 = 'test-bucket1';

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1); // yesterday
const lifecycle_rule_delete_all = [
    {
    "id": "expiration after 3 days with tags",
    "status": "Enabled",
    "filter": {
        "prefix": '',
    },
    "expiration": {
        "date": yesterday.getTime()
    },
}];

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
    const test_bucket_path = `${root_path}/${test_bucket}`;
    const test_key1 = 'test_key1';
    const test_key2 = 'test_key2';
    const prefix = 'test/';
    const test_prefix_key = `${prefix}/test_key1`;
    let object_sdk;
    let nsfs;

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
        await object_sdk.delete_bucket_lifecycle({ name: test_bucket });
        await fs_utils.create_fresh_path(test_bucket_path);
    });

    afterAll(async () => {
        await fs_utils.folder_delete(test_bucket_path);
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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        const res = await object_sdk.create_object_upload({ key: test_key1, bucket: test_bucket });
        await object_sdk.create_object_upload({ key: test_key1, bucket: test_bucket });
        await update_mpu_mtime(res.obj_id);
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const mpu_list = await object_sdk.list_uploads({ bucket: test_bucket });
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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        let res = await object_sdk.create_object_upload({ key: test_key1, bucket: test_bucket });
        await update_mpu_mtime(res.obj_id);
        res = await object_sdk.create_object_upload({ key: test_prefix_key, bucket: test_bucket });
        await update_mpu_mtime(res.obj_id);
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const mpu_list = await object_sdk.list_uploads({ bucket: test_bucket });
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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        let res = await object_sdk.create_object_upload(
            {key: test_key1, bucket: test_bucket, tagging: [...tag_set, ...different_tag_set]});
        await update_mpu_mtime(res.obj_id);
        res = await object_sdk.create_object_upload({ key: test_key1, bucket: test_bucket, tagging: different_tag_set});
        await update_mpu_mtime(res.obj_id);
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const mpu_list = await object_sdk.list_uploads({ bucket: test_bucket });
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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        await create_object(object_sdk, test_bucket, test_key1, 100, true);
        await create_object(object_sdk, test_bucket, test_key2, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await create_object(object_sdk, test_bucket, test_key2, 100, false);

        await update_file_mtime(path.join(test_bucket_path, test_key1));
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        await create_object(object_sdk, test_bucket, test_key1, 100, true);
        await create_object(object_sdk, test_bucket, test_key2, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        await create_object(object_sdk, test_bucket, test_key1, 100, true);
        await create_object(object_sdk, test_bucket, test_prefix_key, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
        const test_key1_tags = [...tag_set, ...different_tag_set];
        await create_object(object_sdk, test_bucket, test_key1, 100, true, test_key1_tags);
        await create_object(object_sdk, test_bucket, test_key2, 100, true, different_tag_set);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        await create_object(object_sdk, test_bucket, test_key1, 100, true);
        await create_object(object_sdk, test_bucket, test_key2, 80, true);
        await create_object(object_sdk, test_bucket, test_prefix_key, 20, true);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
        expect(object_list.objects.length).toBe(2);
        object_list.objects.forEach(element => {
            expect(element.key).not.toBe(test_key2);
        });
    });

    async function update_mpu_mtime(obj_id) {
        const mpu_path = nsfs._mpu_path({obj_id});
        return await update_file_mtime(mpu_path);
    }
});

describe('noobaa cli - lifecycle versioning ENABLE', () => {
    const test_bucket_path = `${root_path}/${test_bucket}`;
    const test_key1 = 'test_key1';
    const test_key2 = 'test_key2';
    const prefix = 'test/';
    const test_prefix_key = `${prefix}test_key1`;
    let object_sdk;

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
        await object_sdk.set_bucket_versioning({name: test_bucket, versioning: "ENABLED"});
    });

    afterEach(async () => {
        await object_sdk.delete_bucket_lifecycle({ name: test_bucket });
        await fs_utils.create_fresh_path(test_bucket_path);
    });

    afterAll(async () => {
        await fs_utils.folder_delete(test_bucket_path);
        await fs_utils.folder_delete(root_path);
        await fs_utils.folder_delete(config_root);
    }, TEST_TIMEOUT);

    it('lifecycle_cli - noncurrent expiration rule - expire older versions', async () => {
        const lifecycle_rule = [
                {
                "id": "expiration after 3 days with tags",
                "status": "Enabled",
                "filter": {
                    "prefix": "",
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 2
                }
            }
        ];
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        const res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await create_object(object_sdk, test_bucket, test_key1, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await object_sdk.list_object_versions({bucket: test_bucket});
        expect(object_list.objects.length).toBe(3);
        object_list.objects.forEach(element => {
            expect(element.version_id).not.toBe(res.version_id);
        });
    });

    it('lifecycle_cli - noncurrent expiration rule - expire older versions with filter', async () => {
        const lifecycle_rule = [
                {
                "id": "expiration after 3 days with tags",
                "status": "Enabled",
                "filter": {
                    "prefix": prefix,
                    "object_size_greater_than": 80,
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 1
                }
            }
        ];
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await create_object(object_sdk, test_bucket, test_key1, 100, false);

        const res = await create_object(object_sdk, test_bucket, test_prefix_key, 100, false);
        await create_object(object_sdk, test_bucket, test_prefix_key, 60, false);
        await create_object(object_sdk, test_bucket, test_prefix_key, 100, false);
        await create_object(object_sdk, test_bucket, test_prefix_key, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await object_sdk.list_object_versions({bucket: test_bucket});
        expect(object_list.objects.length).toBe(6);
        object_list.objects.forEach(element => {
            expect(element.version_id).not.toBe(res.version_id);
        });
    });

    it('lifecycle_cli - noncurrent expiration rule - expire older versions only delete markers', async () => {
        const lifecycle_rule = [
                {
                "id": "expiration after 3 days with tags",
                "status": "Enabled",
                "filter": {
                    "prefix": '',
                    "object_size_less_than": 1,
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 1
                }
            }
        ];
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        await object_sdk.delete_object({bucket: test_bucket, key: test_key1});
        await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await object_sdk.delete_object({bucket: test_bucket, key: test_key1});
        await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await create_object(object_sdk, test_bucket, test_key1, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await object_sdk.list_object_versions({bucket: test_bucket});
        expect(object_list.objects.length).toBe(3);
        object_list.objects.forEach(element => {
            expect(element.delete_marker).not.toBe(true);
        });
    });

    it('lifecycle_cli - noncurrent expiration rule - expire versioning enabled bucket', async () => {
        const date = new Date();
        date.setDate(date.getDate() - 1); // yesterday
        const lifecycle_rule = [
            {
                "id": "expiration after 3 days",
                "status": "Enabled",
                "filter": {
                    "prefix": prefix,
                },
                "expiration": {
                    "date": date.getTime()
                }
            }
        ];
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        await create_object(object_sdk, test_bucket, test_prefix_key, 100, false);
        await create_object(object_sdk, test_bucket, test_prefix_key, 100, false);
        await create_object(object_sdk, test_bucket, test_key2, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list = await object_sdk.list_object_versions({bucket: test_bucket});
        expect(object_list.objects.length).toBe(4); //added delete marker
        let has_delete_marker = false;
        object_list.objects.forEach(element => {
            if (element.delete_marker) has_delete_marker = true;
        });
        expect(has_delete_marker).toBe(true);
    });
});


describe('noobaa cli lifecycle - timeout check', () => {
    const original_lifecycle_timeout = config.NC_LIFECYCLE_TIMEOUT_MS;

    beforeAll(async () => {
        await fs_utils.create_fresh_path(config_root, 0o777);
        set_nc_config_dir_in_config(config_root);
        await fs_utils.create_fresh_path(root_path, 0o777);
        const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, account_options1);
        const json_account = JSON.parse(res).response.reply;
        console.log(json_account);
        const object_sdk = new NsfsObjectSDK('', config_fs, json_account, "DISABLED", config_fs.config_root, undefined);
        object_sdk.requesting_account = json_account;
        // don't delete this bucket creation - it's being used for making sure that the lifecycle run will take more than 1 ms
        await object_sdk.create_bucket({ name: test_bucket });
        await object_sdk.create_bucket({ name: test_bucket1});

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
        const parsed_res1 = JSON.parse(res1.stdout);
        const actual_error = parsed_res1.error;
        expect(actual_error.code).toBe(ManageCLIError.LifecycleWorkerReachedTimeout.code);
        expect(actual_error.message).toBe(ManageCLIError.LifecycleWorkerReachedTimeout.message);
    });
});

describe('noobaa cli - lifecycle batching', () => {
    const test_bucket_path = `${root_path}/${test_bucket}`;
    const test_key1 = 'test_key1';
    const test_key2 = 'test_key2';
    let object_sdk;
    const tmp_lifecycle_logs_dir_path = path.join(root_path, 'test_lifecycle_logs');

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
    });

    beforeEach(async () => {
        await config_fs.create_config_json_file(JSON.stringify({
            NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
            NC_LIFECYCLE_LIST_BATCH_SIZE: 2,
            NC_LIFECYCLE_BUCKET_BATCH_SIZE: 5,
        }));
    });

    afterEach(async () => {
        await object_sdk.delete_bucket_lifecycle({ name: test_bucket });
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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

        await create_object(object_sdk, test_bucket, test_key1, 100, true);
        await create_object(object_sdk, test_bucket, test_key2, 100, true);
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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

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
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

        await create_object(object_sdk, test_bucket, test_key1, 100, true);
        await create_object(object_sdk, test_bucket, test_key2, 100, true);
        await create_object(object_sdk, test_bucket, "key3", 100, true);
        await create_object(object_sdk, test_bucket, "key4", 100, true);
        await create_object(object_sdk, test_bucket, "key5", 100, true);
        const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
        expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
        expect(object_list.objects.length).toBe(0);
    });

    it("lifecycle batching - with lifecycle rule, multiple list batches, multiple bucket batches", async () => {
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

        await create_object(object_sdk, test_bucket, test_key1, 100, true);
        await create_object(object_sdk, test_bucket, test_key2, 100, true);
        await create_object(object_sdk, test_bucket, "key3", 100, true);
        await create_object(object_sdk, test_bucket, "key4", 100, true);
        await create_object(object_sdk, test_bucket, "key5", 100, true);
        await create_object(object_sdk, test_bucket, "key6", 100, true);
        await create_object(object_sdk, test_bucket, "key7", 100, true);
        const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
        expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
        expect(object_list.objects.length).toBe(0);
    });

    it("lifecycle batching - with lifecycle rule, multiple list batches, one bucket batch", async () => {
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

        await create_object(object_sdk, test_bucket, test_key1, 100, true);
        await create_object(object_sdk, test_bucket, test_key2, 100, true);

        await config_fs.update_config_json_file(JSON.stringify({
            NC_LIFECYCLE_TIMEOUT_MS: 1,
            NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
            NC_LIFECYCLE_BUCKET_BATCH_SIZE: 5,
            NC_LIFECYCLE_LIST_BATCH_SIZE: 2
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

    it("lifecycle batching - continue finished lifecycle should do nothing", async () => {
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

        await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true, undefined);
        await create_object(object_sdk, test_bucket, test_key1, 100, true);
        await create_object(object_sdk, test_bucket, test_key2, 100, true);

        //continue finished run
        await exec_manage_cli(TYPES.LIFECYCLE, '', { continue: 'true', disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true, undefined);

        const lifecycle_log_entries = await nb_native().fs.readdir(config_fs.fs_context, tmp_lifecycle_logs_dir_path);
        expect(lifecycle_log_entries.length).toBe(2);
        const log_file_path = path.join(tmp_lifecycle_logs_dir_path, lifecycle_log_entries[0].name);
        const lifecycle_log_json = await config_fs.get_config_data(log_file_path, {silent_if_missing: true});
        expect(lifecycle_log_json.state.is_finished).toBe(true);
        const object_list = await object_sdk.list_objects({bucket: test_bucket});
        expect(object_list.objects.length).toBe(2);
    });

    it("continue lifecycle batching should finish the run - delete all", async () => {
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
        await config_fs.update_config_json_file(JSON.stringify({
            NC_LIFECYCLE_TIMEOUT_MS: 5,
            NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
            NC_LIFECYCLE_BUCKET_BATCH_SIZE: 5,
            NC_LIFECYCLE_LIST_BATCH_SIZE: 2

        }));
        const keys = [test_key1, test_key2, "key3", "key4", "key5", "key6", "key7"];
        for (const key of keys) {
            await create_object(object_sdk, test_bucket, key, 100, false);
        }
        try {
            await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        } catch (e) {
            //ignore timout error
        }
        await config_fs.update_config_json_file(JSON.stringify({
            NC_LIFECYCLE_TIMEOUT_MS: config.NC_LIFECYCLE_TIMEOUT_MS,
            NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
            NC_LIFECYCLE_BUCKET_BATCH_SIZE: 5,
            NC_LIFECYCLE_LIST_BATCH_SIZE: 2

        }));
        await exec_manage_cli(TYPES.LIFECYCLE, '', {continue: 'true', disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list2 = await object_sdk.list_objects({bucket: test_bucket});
        expect(object_list2.objects.length).toBe(0);
    });

    it("continue lifecycle batching should finish the run - validate new run. don't delete already deleted items", async () => {
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
        await config_fs.update_config_json_file(JSON.stringify({
            NC_LIFECYCLE_TIMEOUT_MS: 70,
            NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
            NC_LIFECYCLE_BUCKET_BATCH_SIZE: 4,
            NC_LIFECYCLE_LIST_BATCH_SIZE: 2
        }));
        const keys = [];
        for (let i = 0; i < 100; i++) {
            const new_key = `key${i}`;
            await create_object(object_sdk, test_bucket, new_key, 100, false);
            keys.push(new_key);
        }
        try {
            await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        } catch (e) {
            //ignore error
        }

        const object_list = await object_sdk.list_objects({bucket: test_bucket});
        const intermediate_key_list = object_list.objects.map(object => object.key);
        const new_keys = [];
        //recreate deleted key. next run should skip those keys
        for (const key of keys) {
            if (!intermediate_key_list.includes(key)) {
                await create_object(object_sdk, test_bucket, key, 100, false);
                new_keys.push(key);
            }
        }
        await config_fs.update_config_json_file(JSON.stringify({
            NC_LIFECYCLE_TIMEOUT_MS: 9999,
            NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
            NC_LIFECYCLE_BUCKET_BATCH_SIZE: 4,
            NC_LIFECYCLE_LIST_BATCH_SIZE: 2,
        }));
        await exec_manage_cli(TYPES.LIFECYCLE, '', {continue: 'true', disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const object_list2 = await object_sdk.list_objects({bucket: test_bucket});
        const res_keys = object_list2.objects.map(object => object.key);
        for (const key of new_keys) {
            expect(res_keys).toContain(key);
        }
    });

    it("lifecycle batching - with lifecycle rule, multiple list batches, multiple bucket batches - newer noncurrent versions", async () => {
        const lifecycle_rule = [
                {
                "id": "expiration after 3 days with tags",
                "status": "Enabled",
                "filter": {
                    "prefix": "",
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 2
                }
            }
        ];
        await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        const res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
        for (let i = 0; i < 10; i++) {
            await create_object(object_sdk, test_bucket, test_key1, 100, false);
        }
        const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
        expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);

        const object_list = await object_sdk.list_object_versions({bucket: test_bucket});
        expect(object_list.objects.length).toBe(3);
        object_list.objects.forEach(element => {
            expect(element.version_id).not.toBe(res.version_id);
        });
    });

    it("lifecycle rule, multiple list batches, multiple bucket batches - both expire and noncurrent actions", async () => {
        const lifecycle_rule = [
                {
                "id": "expiration after 3 days with tags",
                "status": "Enabled",
                "filter": {
                    "prefix": "",
                },
                "expiration": {
                    "date": yesterday.getTime()
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 2
                }
            }
        ];
        await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        const keys = [test_key1, test_key2, "key3", "key4", "key5", "key6", "key7"];
        for (const key of keys) {
            await create_object(object_sdk, test_bucket, key, 100, false);
        }
        for (let i = 0; i < 10; i++) {
            await create_object(object_sdk, test_bucket, test_key1, 100, false);
        }
        const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: 'true', disable_runtime_validation: 'true', config_root}, undefined, undefined);
        const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
        expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);

        const object_list = await object_sdk.list_object_versions({bucket: test_bucket});
        const expected_length = keys.length * 2 + 1; //all keys + delete marker for each key + 1 noncurrent versions for test_key1
        expect(object_list.objects.length).toBe(expected_length);
    });
});

describe('noobaa cli - lifecycle notifications', () => {
    const test_bucket_path = `${root_path}/${test_bucket}`;
    const test_key1 = 'test_key1';
    const test_key2 = 'test_key2';
    let object_sdk;
    const tmp_lifecycle_logs_dir_path = path.join(root_path, 'test_lifecycle_notifications_logs');
    const tmp_conn_dir_path = path.join(root_path, 'test_notification_logs');
    const http_connect_filename = 'http_connect.json';
    const http_connect_path = path.join(tmp_conn_dir_path, http_connect_filename);
    //content of connect file, will be written to a file in before()
    const http_connect = {
        agent_request_object: {"host": "localhost", "port": 9998, "timeout": 1500},
        request_options_object: {"auth": "amit:passw", "timeout": 1500},
        notification_protocol: 'http',
        name: 'http_notif'
    };

    const notifications_json = {
        bucket_name: test_bucket,
        notifications:
        [{
            id: ["test id"],
            topic: [http_connect_filename],
            event: [
                "s3:LifecycleExpiration:Delete",
                "s3:LifecycleExpiration:DeleteMarkerCreated"
            ]
        }],
    };

    beforeAll(async () => {
        //create paths
        await fs_utils.create_fresh_path(config_root, 0o777);
        set_nc_config_dir_in_config(config_root);
        await fs_utils.create_fresh_path(root_path, 0o777);
        await fs_utils.create_fresh_path(tmp_lifecycle_logs_dir_path, 0o777);
        await fs_utils.create_fresh_path(tmp_conn_dir_path, 0o777);

        //create account and bucket
        const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, account_options1);
        const json_account = JSON.parse(res).response.reply;
        await create_system_json(config_fs);
        object_sdk = new NsfsObjectSDK('', config_fs, json_account, "DISABLED", config_fs.config_root, undefined);
        object_sdk.requesting_account = json_account;
        await object_sdk.create_bucket({ name: test_bucket });

        //configure bucket notifications
        config.NOTIFICATION_LOG_DIR = tmp_lifecycle_logs_dir_path;
        config.NOTIFICATION_CONNECT_DIR = tmp_conn_dir_path;
        fs.writeFileSync(http_connect_path, JSON.stringify(http_connect));
        await object_sdk.put_bucket_notification(notifications_json);
        await config_fs.create_config_json_file(JSON.stringify({ NOTIFICATION_LOG_DIR: tmp_lifecycle_logs_dir_path }));
    });

    afterEach(async () => {
        await object_sdk.delete_bucket_lifecycle({ name: test_bucket });
        await fs_utils.create_fresh_path(test_bucket_path);
        await fs_utils.create_fresh_path(tmp_lifecycle_logs_dir_path);
    });

    afterAll(async () => {
        await fs_utils.folder_delete(root_path);
        await fs_utils.folder_delete(config_root);
    }, TEST_TIMEOUT);

    it('lifecycle_cli - lifecycle rule with Delete notification', async () => {
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
        await create_object(object_sdk, test_bucket, test_key1, 100, true);
        await create_object(object_sdk, test_bucket, test_key2, 100, true);
        await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true);

        const object_list = await object_sdk.list_objects({bucket: test_bucket});
        expect(object_list.objects.length).toBe(0);

        const notification_log_entries = await get_notifications_obj();
        expect(notification_log_entries.length).toBe(2);

        notification_log_entries.forEach(notification => {
            const record = notification.notif.Records[0];
            expect(record.eventName).toBe('LifecycleExpiration:Delete');
            expect(record.s3.bucket.name).toBe(test_bucket);
            expect(record.s3.object.size).toBe(100);
            expect([test_key1, test_key2]).toContain(record.s3.object.key);
        });
    });

    it('lifecycle_cli - lifecycle rule with Delete marker notification', async () => {
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
        await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });

        await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await create_object(object_sdk, test_bucket, test_key2, 100, false);
        await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true);

        const object_list = await object_sdk.list_object_versions({bucket: test_bucket});
        expect(object_list.objects.length).toBe(4);

        const notification_log_entries = await get_notifications_obj();
        expect(notification_log_entries.length).toBe(2);

        notification_log_entries.forEach(notification => {
            const record = notification.notif.Records[0];
            expect(record.eventName).toBe('LifecycleExpiration:DeleteMarkerCreated');
            expect(record.s3.bucket.name).toBe(test_bucket);
            expect(record.s3.object.size).toBe(100);
            expect([test_key1, test_key2]).toContain(record.s3.object.key);
        });
    });

    it('lifecycle_cli - should not notify', async () => {
        notifications_json.notifications[0].event = ["s3:LifecycleExpiration:Delete"];
        await object_sdk.put_bucket_notification(notifications_json);
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
        await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });

        await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await create_object(object_sdk, test_bucket, test_key2, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true);
        await config_fs.delete_config_json_file();

        const object_list = await object_sdk.list_object_versions({bucket: test_bucket});
        expect(object_list.objects.length).toBe(4);

        //there should not be any notifications
        const notification_log_entries = await nb_native().fs.readdir(config_fs.fs_context, tmp_lifecycle_logs_dir_path);
        expect(notification_log_entries.length).toBe(0);
    });

    async function get_notifications_obj() {
        const notification_log_entries = await nb_native().fs.readdir(config_fs.fs_context, tmp_lifecycle_logs_dir_path);
        expect(notification_log_entries.length).toBe(1);
        const log_file_path = path.join(tmp_lifecycle_logs_dir_path, notification_log_entries[0].name);
        const { data: notifications_buffer } = await nb_native().fs.readFile(config_fs.fs_context, log_file_path);
        const notification_list = notifications_buffer.toString().split('\n');
        notification_list.pop(); //remove last empty element
        const notifications_parsed = notification_list.map(str => JSON.parse(str));
        return notifications_parsed;
    }
});

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
