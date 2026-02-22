/* Copyright (C) 2016 NooBaa */
/* eslint-disable max-lines-per-function */
/* eslint-disable  max-lines */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const path = require('path');
const fs = require('fs');
const config = require('../../../../../config');
const fs_utils = require('../../../../util/fs_utils');
const { ConfigFS } = require('../../../../sdk/config_fs');
const { TMP_PATH, set_nc_config_dir_in_config, TEST_TIMEOUT, exec_manage_cli, create_system_json, update_file_mtime } = require('../../../system_tests/test_utils');
const { TYPES, ACTIONS } = require('../../../../manage_nsfs/manage_nsfs_constants');
const NamespaceFS = require('../../../../sdk/namespace_fs');
const endpoint_stats_collector = require('../../../../sdk/endpoint_stats_collector');
const { ManageCLIResponse } = require('../../../../manage_nsfs/manage_nsfs_cli_responses');
const { ManageCLIError } = require('../../../../manage_nsfs/manage_nsfs_cli_errors');
const buffer_utils = require('../../../../util/buffer_utils');
const crypto = require('crypto');
const NsfsObjectSDK = require('../../../../sdk/nsfs_object_sdk');
const nb_native = require('../../../../util/nb_native');
const native_fs_utils = require('../../../../util/native_fs_utils');

const LIFECYCLE_RULE_STATUS_ENUM = Object.freeze({
    ENABLED: 'Enabled',
    DISABLED: 'Disabled'
});

const new_umask = process.env.NOOBAA_ENDPOINT_UMASK || 0o000;
const old_umask = process.umask(new_umask);
console.log('test_nc_lifecycle_cli: replacing old umask: ', old_umask.toString(8), 'with new umask: ', new_umask.toString(8));

const config_root = path.join(TMP_PATH, 'config_root_nc_lifecycle_posix_integration');
const root_path = path.join(TMP_PATH, 'root_path_nc_lifecycle_posix_integration/');
const config_fs = new ConfigFS(config_root);
const account_options1 = { uid: 2002, gid: 2002, new_buckets_path: root_path, name: 'user2', config_root, allow_bucket_creation: 'true' };
const test_bucket = 'test-bucket';
const test_bucket1 = 'test-bucket1';

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1); // yesterday
const lifecycle_rule_delete_all = [{
    "id": "expiration after day to all objects",
    "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
    "filter": {
        "prefix": '',
    },
    "expiration": {
        "date": yesterday.getTime()
    },
}];

describe('noobaa nc - lifecycle - lock check', () => {
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

    it('nc lifecycle - change run time to now - 2 locks - the second should fail ', async () => {
        await config_fs.create_config_json_file(JSON.stringify({ NC_LIFECYCLE_RUN_TIME: date_to_run_time_format() }));
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

    it('nc lifecycle - no run time change - 2 locks - both should fail ', async () => {
        const res1 = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', config_root }, undefined, undefined);
        const res2 = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', config_root }, undefined, undefined);
        const parsed_res1 = JSON.parse(res1).response;
        expect(parsed_res1.code).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.code);
        expect(parsed_res1.message).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.message);
        const parsed_res2 = JSON.parse(res2).response;
        expect(parsed_res2.code).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.code);
        expect(parsed_res2.message).toBe(ManageCLIResponse.LifecycleWorkerNotRunning.message);
    });

    it('nc lifecycle - change run time to 4 minutes ago - should fail ', async () => {
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

    it('nc lifecycle - change run time to 1 minutes ago - should succeed ', async () => {
        const lifecyle_run_date = new Date();
        lifecyle_run_date.setMinutes(lifecyle_run_date.getMinutes() - 1);
        await config_fs.create_config_json_file(JSON.stringify({
            NC_LIFECYCLE_RUN_TIME: date_to_run_time_format(lifecyle_run_date),
            NC_LIFECYCLE_RUN_DELAY_LIMIT_MINS: 5
        }));
        const res = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', config_root }, undefined, undefined);
        await config_fs.delete_config_json_file();
        const parsed_res = JSON.parse(res).response;
        expect(parsed_res.code).toBe(ManageCLIResponse.LifecycleSuccessful.code);
        expect(parsed_res.message).toBe(ManageCLIResponse.LifecycleSuccessful.message);
    });

    it('nc lifecycle - change run time to 10 minute in the future - should fail ', async () => {
        const lifecyle_run_date = new Date();
        lifecyle_run_date.setMinutes(lifecyle_run_date.getMinutes() + 10);
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

describe('noobaa nc - lifecycle versioning DISABLED', () => {
    const test_bucket_path = `${root_path}/${test_bucket}`;
    const test_key1_regular = 'test_key1';
    const test_key2_regular = 'test_key2';
    const test_key1_nested = 'nested/test_key1';
    const test_key2_nested = 'nested/test_key2';
    const test_key1_object_dir = 'test_key1_dir/';
    const test_key2_object_dir = 'test_key2_dir/';
    const prefix = 'test/';
    const test_prefix_key_regular = `${prefix}${test_key1_regular}`;
    const test_prefix_key_nested = `${prefix}${test_key1_nested}`;
    const test_prefix_key_object_dir = `${prefix}${test_key1_object_dir}`;
    let object_sdk;
    let nsfs;
    const test_cases = [
        { description: 'regular key', test_key1: test_key1_regular, test_key2: test_key2_regular, test_prefix_key: test_prefix_key_regular },
        { description: 'nested key', test_key1: test_key1_nested, test_key2: test_key2_nested, test_prefix_key: test_prefix_key_nested },
        { description: 'object dir (key with suffix of "/")', test_key1: test_key1_object_dir, test_key2: test_key2_object_dir, test_prefix_key: test_prefix_key_object_dir },
    ];

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

    describe('noobaa nc - lifecycle -  abort mpu', () => {
        it('nc lifecycle - abort mpu by number of days - regular', async () => {
            const lifecycle_rule = [{
                "id": "abort mpu after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": { "prefix": "" },
                "abort_incomplete_multipart_upload": {
                    "days_after_initiation": 3
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            const res = await object_sdk.create_object_upload({ key: test_key1_regular, bucket: test_bucket });
            await object_sdk.create_object_upload({ key: test_key1_regular, bucket: test_bucket });
            await update_mpu_mtime(res.obj_id);
            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const mpu_list = await object_sdk.list_uploads({ bucket: test_bucket });
            expect(mpu_list.objects.length).toBe(1); //removed the mpu that was created 5 days ago
        });

        it('nc lifecycle - abort mpu by number of days - status is Disabled (do not perform the deletion) - regular', async () => {
            const lifecycle_rule = [{
                "id": "abort mpu after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.DISABLED,
                "filter": { "prefix": "" },
                "abort_incomplete_multipart_upload": {
                    "days_after_initiation": 3
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            const res = await object_sdk.create_object_upload({ key: test_key1_regular, bucket: test_bucket });
            await object_sdk.create_object_upload({ key: test_key1_regular, bucket: test_bucket });
            await update_mpu_mtime(res.obj_id);
            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const mpu_list = await object_sdk.list_uploads({ bucket: test_bucket });
            expect(mpu_list.objects.length).toBe(2); // nothing was removed
        });

        it('nc lifecycle - abort mpu by prefix and number of days - regular', async () => {
            const lifecycle_rule = [{
                "id": "abort mpu after 3 days for prefix",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": { "prefix": prefix },
                "abort_incomplete_multipart_upload": {
                    "days_after_initiation": 3
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            let res = await object_sdk.create_object_upload({ key: test_key1_regular, bucket: test_bucket });
            await update_mpu_mtime(res.obj_id);
            res = await object_sdk.create_object_upload({ key: test_prefix_key_regular, bucket: test_bucket });
            await update_mpu_mtime(res.obj_id);
            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const mpu_list = await object_sdk.list_uploads({ bucket: test_bucket });
            // only removed test_prefix_key (test/test_key1) as the rule contains the prefix (test/)
            expect(mpu_list.objects.length).toBe(1);
            expect(mpu_list.objects[0].key).not.toBe(test_prefix_key_regular);
        });
    });

    describe('noobaa nc - lifecycle -  expiration rule', () => {
        it.each(test_cases)('nc lifecycle - expiration rule - by number of days - $description', async ({ description, test_key1, test_key2, test_prefix_key }) => {
            const lifecycle_rule = [{
                "id": "expiration after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                },
                "expiration": {
                    "days": 3
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            await create_object(object_sdk, test_bucket, test_key1, 100, true);
            await create_object(object_sdk, test_bucket, test_key2, 100, false);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(1);
            expect(object_list.objects[0].key).toBe(test_key2);
        });

        it('nc lifecycle - expiration rule - by number of days - status is Disabled (do not perform the deletion) - regular key', async () => {
            const lifecycle_rule = [{
                "id": "expiration after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.DISABLED,
                "filter": {
                    "prefix": '',
                },
                "expiration": {
                    "days": 3
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, true);
            await create_object(object_sdk, test_bucket, test_key2_regular, 100, false);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(2); //should not delete any entry
        });

        it('nc lifecycle - expiration rule - by date - after the date - regular key', async () => {
            const date = new Date();
            date.setDate(date.getDate() - 1); // yesterday
            const lifecycle_rule = [{
                "id": "expiration by date",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                },
                "expiration": {
                    "date": date.getTime()
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_key2_regular, 100, false);

            await update_file_mtime(path.join(test_bucket_path, test_key1_regular));
            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(0); //should delete all objects
        });

        it('nc lifecycle - expiration rule - by date - before the date - regular key', async () => {
            const date = new Date();
            date.setDate(date.getDate() + 1); // tomorrow
            const lifecycle_rule = [{
                "id": "expiration by date",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                },
                "expiration": {
                    "date": date.getTime()
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, true);
            await create_object(object_sdk, test_bucket, test_key2_regular, 100, false);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(2); //should not delete any entry
        });

        it('nc lifecycle - expiration rule - with prefix - regular', async () => {
            const date = new Date();
            date.setDate(date.getDate() - 1); // yesterday
            const lifecycle_rule = [{
                "id": "expiration by prefix",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": prefix,
                },
                "expiration": {
                    "date": date.getTime()
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, true);
            await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(1);
            expect(object_list.objects[0].key).toBe(test_key1_regular);
        });

        it.each(test_cases)('nc lifecycle - expiration rule - filter by tags- $description', async ({ description, test_key1, test_key2, test_prefix_key }) => {
            const tag_set = [{ key: "key1", value: "val1" }, { key: "key2", value: "val2" }];
            const different_tag_set = [{ key: "key5", value: "val5" }];
            const lifecycle_rule = [{
                "id": "expiration after 3 days with tags",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                    "tags": tag_set
                },
                "expiration": {
                    "days": 3
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            const test_key1_tags = [...tag_set, ...different_tag_set];
            await create_object(object_sdk, test_bucket, test_key1, 100, true, test_key1_tags);
            await create_object(object_sdk, test_bucket, test_key2, 100, true, different_tag_set);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(1);
            expect(object_list.objects[0].key).toBe(test_key2);
        });

        it('nc lifecycle - expiration rule - filter by size - regular key', async () => {
            const lifecycle_rule = [{
                "id": "filter by size and expiration after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                    "object_size_greater_than": 30,
                    "object_size_less_than": 90
                },
                "expiration": {
                    "days": 3
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await create_object(object_sdk, test_bucket, test_key1_regular, 100, true);
            await create_object(object_sdk, test_bucket, test_key2_regular, 80, true); // expected to be deleted according to filtering by size (30 < 80 < 90)
            await create_object(object_sdk, test_bucket, test_prefix_key_regular, 20, true);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(2);
            object_list.objects.forEach(element => {
                expect(element.key).not.toBe(test_key2_regular);
            });
        });
    });

    async function update_mpu_mtime(obj_id) {
        const mpu_path = nsfs._mpu_path({ obj_id });
        return await update_file_mtime(mpu_path);
    }
});

describe('noobaa nc - lifecycle versioning ENABLED', () => {
    const test_bucket_path = `${root_path}/${test_bucket}`;
    const test_key1_regular = 'test_key1';
    const test_key2_regular = 'test_key2';
    const test_key3_regular = 'test_key3';
    const test_key1_nested = 'nested/test_key1';
    const test_key2_nested = 'nested/test_key2';
    const test_key3_nested = 'nested/test_key3';
    const prefix = 'test/';
    const test_prefix_key_regular = `${prefix}${test_key1_regular}`;
    const test_prefix_key_nested = `${prefix}${test_key1_nested}`;
    const test_cases = [
        { description: 'regular key', test_key1: test_key1_regular, test_key2: test_key2_regular, test_key3: test_key3_regular, test_prefix_key: test_prefix_key_regular },
        { description: 'nested key', test_key1: test_key1_nested, test_key2: test_key2_nested, test_key3: test_key3_nested, test_prefix_key: test_prefix_key_nested },
    ];
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
        await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: "ENABLED" });
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

    it('nc lifecycle - versioning ENABLED - expiration rule - regular key', async () => {
        const date = new Date();
        date.setDate(date.getDate() - 1); // yesterday
        const lifecycle_rule = [{
            "id": "expiration after 3 days",
            "status": "Enabled",
            "filter": {
                "prefix": prefix,
            },
            "expiration": {
                "date": date.getTime()
            }
        }];
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
        await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
        await create_object(object_sdk, test_bucket, test_key2_regular, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
        const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
        expect(object_list.objects.length).toBe(4); //added delete marker
        let has_delete_marker = false;
        object_list.objects.forEach(element => {
            if (element.delete_marker) has_delete_marker = true;
        });
        expect(has_delete_marker).toBe(true);
    });


    describe('noobaa nc - lifecycle versioning ENABLED - noncurrent expiration rule', () => {
        it.each(test_cases)('nc lifecycle - versioning ENABLED - noncurrent expiration rule - expire older versions - $description', async ({ description, test_key1, test_key2, test_key3, test_prefix_key }) => {
            const lifecycle_rule = [{
                "id": "keep 2 noncurrent versions",
                "status": "Enabled",
                "filter": {
                    "prefix": "",
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 2,
                    "noncurrent_days": 1
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            const res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
            await create_object(object_sdk, test_bucket, test_key1, 100, false);
            await create_object(object_sdk, test_bucket, test_key1, 100, false);
            await create_object(object_sdk, test_bucket, test_key1, 100, false);
            await update_version_xattr(test_bucket, test_key1, res.version_id);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(3);
            object_list.objects.forEach(element => {
                expect(element.version_id).not.toBe(res.version_id);
            });
        });

        it('nc lifecycle - versioning ENABLED - noncurrent expiration rule - expire older versions with filter - regular key', async () => {
            const lifecycle_rule = [{
                "id": "keep 1 noncurrent version with filter",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": prefix,
                    "object_size_greater_than": 80,
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 1,
                    "noncurrent_days": 1
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            const res = await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await update_version_xattr(test_bucket, test_key1_regular, res.version_id);

            const res_prefix = await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_prefix_key_regular, 60, false);
            await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            await update_version_xattr(test_bucket, test_prefix_key_regular, res_prefix.version_id);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(6);
            object_list.objects.forEach(element => {
                expect(element.version_id).not.toBe(res_prefix.version_id);
            });
        });

        it('nc lifecycle - versioning ENABLED - noncurrent expiration rule - expire older versions only delete markers - regular key', async () => {
            const lifecycle_rule = [{
                "id": "keep 1 noncurrent with size filter",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                    "object_size_less_than": 1,
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 1,
                    "noncurrent_days": 1
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            let res1 = await object_sdk.delete_object({ bucket: test_bucket, key: test_prefix_key_regular });
            await update_version_xattr(test_bucket, test_prefix_key_regular, res1.created_version_id);
            let res2 = await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            res1 = await object_sdk.delete_object({ bucket: test_bucket, key: test_prefix_key_regular });
            await update_version_xattr(test_bucket, test_prefix_key_regular, res1.created_version_id);
            await update_version_xattr(test_bucket, test_prefix_key_regular, res2.version_id);
            res2 = await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            res1 = await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            await update_version_xattr(test_bucket, test_prefix_key_regular, res2.version_id);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(3);
            object_list.objects.forEach(element => {
                expect(element.delete_marker).not.toBe(true);
            });
        });

        it('nc lifecycle - versioning ENABLED - noncurrent expiration rule - expire older versions by number of days with filter - regular key', async () => {
            const lifecycle_rule = [{
                "id": "expire noncurrent versions after 3 days with size ",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": prefix,
                    "object_size_greater_than": 80,
                },
                "noncurrent_version_expiration": {
                    "noncurrent_days": 3
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            let res = await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await update_version_xattr(test_bucket, test_key1_regular, res.version_id);

            const expected_res = await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            res = await create_object(object_sdk, test_bucket, test_prefix_key_regular, 60, false);
            await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            await update_version_xattr(test_bucket, test_prefix_key_regular, expected_res.version_id);
            await update_version_xattr(test_bucket, test_prefix_key_regular, res.version_id);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(5);
            object_list.objects.forEach(element => {
                expect(element.version_id).not.toBe(expected_res.version_id);
            });
        });

        it('nc lifecycle - versioning ENABLED - noncurrent expiration rule - expire older versions by number of days whith expire delete marker rule', async () => {
            const lifecycle_rule = [{
                "id": "expire noncurrent versions after 3 days with size ",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                },
                "expiration": {
                    "expired_object_delete_marker": true
                },
                "noncurrent_version_expiration": {
                    "noncurrent_days": 3
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            const res = await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await update_version_xattr(test_bucket, test_key1_regular, res.version_id);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(1);
            object_list.objects.forEach(element => {
                expect(element.version_id).not.toBe(res.version_id);
            });
        });

        it('nc lifecycle - versioning ENABLED - noncurrent expiration rule - both noncurrent days and older versions', async () => {
            const lifecycle_rule = [{
                "id": "expire noncurrent versions after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                },
                "noncurrent_version_expiration": {
                    "noncurrent_days": 3,
                    "newer_noncurrent_versions": 1
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            const expected_res = await create_object(object_sdk, test_bucket, test_key1_regular, 100, false); // the second newest noncurrent version (will be deleted)
            const res = await create_object(object_sdk, test_bucket, test_key1_regular, 100, false); // the newest noncurrent version
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false); // latest version
            await update_version_xattr(test_bucket, test_key1_regular, expected_res.version_id);
            await update_version_xattr(test_bucket, test_key1_regular, res.version_id);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(2);
            object_list.objects.forEach(element => {
                expect(element.version_id).not.toBe(expected_res.version_id);
            });
        });

        it('nc lifecycle - versioning ENABLED - noncurrent expiration rule - older versions valid but noncurrent_days not valid', async () => {
            const lifecycle_rule = [{
                "id": "expire noncurrent versions after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                },
                "noncurrent_version_expiration": {
                    "noncurrent_days": 3,
                    "newer_noncurrent_versions": 1
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            // more than one noncurrent version but not older than 3 days - don't delete
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(3);
        });
    });

    describe('noobaa nc - lifecycle versioning ENABLED - expiration rule - delete marker', () => {
        it.each(test_cases)('nc lifecycle - versioning ENABLED - expiration rule - expire delete marker - $description', async ({ description, test_key1, test_key2, test_key3, test_prefix_key }) => {
            const lifecycle_rule = [{
                "id": "expired_object_delete_marker no filters",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                },
                "expiration": {
                    "expired_object_delete_marker": true
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key1 });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key2 });

            await create_object(object_sdk, test_bucket, test_prefix_key, 100, false);
            await object_sdk.delete_object({ bucket: test_bucket, key: test_prefix_key });

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(2); // test_prefix_key as older version and a delete marker, hence it doesn't considered expired
            object_list.objects.forEach(element => {
                expect(element.key).toBe(test_prefix_key);
            });
        });

        it('nc lifecycle - versioning ENABLED - expiration rule - expire delete marker with filter - regular key', async () => {
            const lifecycle_rule = [{
                "id": "expired_object_delete_marker with filter by prefix and size",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": prefix,
                    "object_size_less_than": 1
                },
                "expiration": {
                    "expired_object_delete_marker": true
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await object_sdk.delete_object({ bucket: test_bucket, key: test_key1_regular });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_prefix_key_regular });

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(1);
            expect(object_list.objects[0].key).toBe(test_key1_regular);
        });

        it('nc lifecycle - versioning ENABLED - expiration rule - expire delete marker last item', async () => {
            const lifecycle_rule = [{
                "id": "expiration of delete marker with filter by size and prefix",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                    "object_size_less_than": 1
                },
                "expiration": {
                    "expired_object_delete_marker": true
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await object_sdk.delete_object({ bucket: test_bucket, key: test_key1_regular });

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(0);
        });

        it('nc lifecycle - versioning ENABLED - expiration rule - last item in batch is latest delete marker', async () => {
            const lifecycle_rule = [{
                "id": "filter by size and no filter by prefix with expiration of delete marker",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                    "object_size_less_than": 1
                },
                "expiration": {
                    "expired_object_delete_marker": true
                }
            }];
            await config_fs.create_config_json_file(JSON.stringify({
                NC_LIFECYCLE_LIST_BATCH_SIZE: 3,
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 3,
            }));
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await object_sdk.delete_object({ bucket: test_bucket, key: test_key1_regular });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key1_regular });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key2_regular }); //last in batch should not delete
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key2_regular });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key3_regular }); // last in batch should delete
            await object_sdk.delete_object({ bucket: test_bucket, key: 'test_key4' });

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(4);
            object_list.objects.forEach(element => {
                expect([test_key1_regular, test_key2_regular]).toContain(element.key);
            });
        });
    });

});

describe('noobaa nc - lifecycle versioning SUSPENDED', () => {
    const test_bucket_path = `${root_path}/${test_bucket}`;
    const test_key1_regular = 'test_key1';
    const test_key2_regular = 'test_key2';
    const test_key3_regular = 'test_key3';
    const test_key1_nested = 'nested/test_key1';
    const test_key2_nested = 'nested/test_key2';
    const test_key3_nested = 'nested/test_key3';
    const prefix = 'test/';
    const test_prefix_key_regular = `${prefix}${test_key1_regular}`;
    const test_prefix_key_nested = `${prefix}${test_key1_nested}`;
    const test_cases = [
        { description: 'regular key', test_key1: test_key1_regular, test_key2: test_key2_regular, test_key3: test_key3_regular, test_prefix_key: test_prefix_key_regular },
        { description: 'nested key', test_key1: test_key1_nested, test_key2: test_key2_nested, test_key3: test_key3_nested, test_prefix_key: test_prefix_key_nested },
    ];
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
        await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: "SUSPENDED" });
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

    it('nc lifecycle - versioning SUSPENDED - expiration rule - regular key', async () => {
        const date = new Date();
        date.setDate(date.getDate() - 1); // yesterday
        const lifecycle_rule = [{
            "id": "expiration after 3 days",
            "status": "Enabled",
            "filter": {
                "prefix": prefix,
            },
            "expiration": {
                "date": date.getTime()
            }
        }];
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

        await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false); // matches prefix filter - will effectively deletes the object
        await create_object(object_sdk, test_bucket, test_key2_regular, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
        const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
        expect(object_list.objects.length).toBe(2); // one that didn't match and a delete marker of the one that matched
        const matched_filter_object = object_list.objects.find(element => element.key === test_prefix_key_regular);
        expect(matched_filter_object.version_id).toBe('null');
        expect(matched_filter_object.delete_marker).toBe(true);
        const non_matched_filter_object = object_list.objects.find(element => element.key === test_key2_regular);
        expect(non_matched_filter_object.version_id).toBe('null');
        expect(non_matched_filter_object.delete_marker).toBe(false);
    });

    describe('noobaa nc - lifecycle versioning SUSPENDED - noncurrent expiration rule', () => {
        it.each(test_cases)('nc lifecycle - versioning SUSPENDED - noncurrent expiration rule - expire older versions - $description', async ({ description, test_key1, test_key2, test_prefix_key }) => {
            const lifecycle_rule = [{
                "id": "keep 2 noncurrent versions",
                "status": "Enabled",
                "filter": {
                    "prefix": "",
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 2,
                    "noncurrent_days": 1
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            for (let i = 0; i < 5; i++) {
                await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            }
            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            // in case the versioning is SUSPENDED the number of newer_noncurrent_versions is not relevant and we would have only the latest version (with version_id null)
            expect(object_list.objects.length).toBe(1);
            expect(object_list.objects[0].version_id).toBe('null');
            expect(object_list.objects[0].is_latest).toBe(true);
        });

        it('nc lifecycle - versioning SUSPENDED - noncurrent expiration rule - expire older versions with filter - regular key', async () => {
            const lifecycle_rule = [{
                "id": "keep 1 noncurrent version with filter",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": prefix,
                    "object_size_greater_than": 80,
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 1,
                    "noncurrent_days": 1
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: "ENABLED" });
            const version_arr = [];
            let res = await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false); // filter by prefix + size
            version_arr.push(res.version_id);
            for (let i = 0; i < 2; i++) {
                const prev_res = res;
                res = await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false); // filter by prefix + size
                await update_version_xattr(test_bucket, test_prefix_key_regular, prev_res.version_id);
                version_arr.push(res.version_id);
            }
            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: "SUSPENDED" });
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false); // doesn't match prefix filter
            await create_object(object_sdk, test_bucket, `${prefix}${test_key2_regular}`, 60, false); // doesn't match size filter
            await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false); // filter by prefix + size


            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(4); // 2 of the mismatched keys (1 version) + 2 versions the filtered key 

            const filtered_versions = object_list.objects.filter(element => element.key === test_prefix_key_regular);
            expect(filtered_versions.length).toBe(2);
            expect(['null', version_arr[2]]).toContain(filtered_versions[0].version_id);
            expect(['null', version_arr[2]]).toContain(filtered_versions[1].version_id);
        });

        it('nc lifecycle - versioning SUSPENDED - noncurrent expiration rule - expire older versions by number of days with filter - regular key', async () => {
            const lifecycle_rule = [{
                "id": "expire noncurrent versions after 3 days with size ",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": prefix,
                    "object_size_greater_than": 80,
                },
                "noncurrent_version_expiration": {
                    "noncurrent_days": 3
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: "ENABLED" });
            let res = await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await update_version_xattr(test_bucket, test_key1_regular, res.version_id);

            const expected_res = await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            res = await create_object(object_sdk, test_bucket, test_prefix_key_regular, 60, false);
            await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_prefix_key_regular, 100, false);
            await update_version_xattr(test_bucket, test_prefix_key_regular, expected_res.version_id);
            await update_version_xattr(test_bucket, test_prefix_key_regular, res.version_id);
            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: "SUSPENDED" });

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(5);
            object_list.objects.forEach(element => {
                expect(element.version_id).not.toBe(expected_res.version_id);
            });
        });

        it('nc lifecycle - versioning SUSPENDED - noncurrent expiration rule - both noncurrent days and older versions', async () => {
            const lifecycle_rule = [{
                "id": "expire noncurrent versions after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                },
                "noncurrent_version_expiration": {
                    "noncurrent_days": 3,
                    "newer_noncurrent_versions": 1
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: "ENABLED" });
            const expected_res = await create_object(object_sdk, test_bucket, test_key1_regular, 100, false); // the second newest noncurrent version (will be deleted)
            const res = await create_object(object_sdk, test_bucket, test_key1_regular, 100, false); // the newest noncurrent version
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false); // latest version
            await update_version_xattr(test_bucket, test_key1_regular, expected_res.version_id);
            await update_version_xattr(test_bucket, test_key1_regular, res.version_id);
            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: "SUSPENDED" });


            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(2);
            object_list.objects.forEach(element => {
                expect(element.version_id).not.toBe(expected_res.version_id);
            });
        });

        it('nc lifecycle - versioning SUSPENDED - noncurrent expiration rule - older versions valid but noncurrent_days not valid', async () => {
            const lifecycle_rule = [{
                "id": "expire noncurrent versions after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                },
                "noncurrent_version_expiration": {
                    "noncurrent_days": 3,
                    "newer_noncurrent_versions": 1
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: "ENABLED" });
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            // more than one noncurrent version but not older than 3 days - don't delete
            await create_object(object_sdk, test_bucket, test_key1_regular, 100, false);
            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: "SUSPENDED" });

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(3);
        });

    });

    describe('noobaa nc - lifecycle versioning SUSPENDED - expiration rule - delete marker', () => {
        it.each(test_cases)('nc lifecycle - versioning SUSPENDED - expiration rule - expire delete marker - $description', async ({ description, test_key1, test_key2, test_prefix_key }) => {
            const lifecycle_rule = [{
                "id": "expired_object_delete_marker no filters",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                },
                "expiration": {
                    "expired_object_delete_marker": true
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key1 });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key2 });

            await create_object(object_sdk, test_bucket, test_prefix_key, 100, false);
            await object_sdk.delete_object({ bucket: test_bucket, key: test_prefix_key }); // in SUSPENDED mode there would be only the delete marker of test_prefix_key with version id id of null

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(0); // all the objects doesn't have an older version and we have only delete markers
        });

        it('nc lifecycle - versioning SUSPENDED - expiration rule - expire delete marker with filter - regular key', async () => {
            const lifecycle_rule = [{
                "id": "expired_object_delete_marker with filter by prefix and size",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": prefix,
                    "object_size_less_than": 1
                },
                "expiration": {
                    "expired_object_delete_marker": true
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await object_sdk.delete_object({ bucket: test_bucket, key: test_key1_regular });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_prefix_key_regular });

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(1);
            expect(object_list.objects[0].key).toBe(test_key1_regular);
        });

        it('nc lifecycle - versioning SUSPENDED - expiration rule - expire delete marker last item', async () => {
            const lifecycle_rule = [{
                "id": "expiration of delete marker with filter by size and prefix",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                    "object_size_less_than": 1
                },
                "expiration": {
                    "expired_object_delete_marker": true
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await object_sdk.delete_object({ bucket: test_bucket, key: test_key1_regular });

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(0);
        });

        it('nc lifecycle - versioning SUSPENDED - expiration rule - last item in batch is latest delete marker', async () => {
            const lifecycle_rule = [{
                "id": "filter by size and no filter by prefix with expiration of delete marker",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                    "object_size_less_than": 1
                },
                "expiration": {
                    "expired_object_delete_marker": true
                }
            }];
            await config_fs.create_config_json_file(JSON.stringify({
                NC_LIFECYCLE_LIST_BATCH_SIZE: 3,
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 3,
            }));
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            await object_sdk.delete_object({ bucket: test_bucket, key: test_key1_regular });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key1_regular });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key2_regular }); // last in batch should not delete
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key2_regular });
            await object_sdk.delete_object({ bucket: test_bucket, key: test_key3_regular }); // last in batch should delete
            await object_sdk.delete_object({ bucket: test_bucket, key: 'test_key4' });

            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(0);
        });
    });
});

describe('noobaa nc lifecycle - timeout check', () => {
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
        await object_sdk.create_bucket({ name: test_bucket1 });

    });

    afterEach(async () => {
        config.NC_LIFECYCLE_TIMEOUT_MS = original_lifecycle_timeout;
        await fs_utils.folder_delete(config.NC_LIFECYCLE_LOGS_DIR);
    });

    afterAll(async () => {
        await fs_utils.folder_delete(root_path);
        await fs_utils.folder_delete(config_root);
    }, TEST_TIMEOUT);

    it('nc lifecycle - change timeout to 1 ms - should fail', async () => {
        await config_fs.create_config_json_file(JSON.stringify({ NC_LIFECYCLE_TIMEOUT_MS: 1 }));
        const res1 = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true, undefined);
        await config_fs.delete_config_json_file();
        const parsed_res1 = JSON.parse(res1.stdout);
        const actual_error = parsed_res1.error;
        expect(actual_error.code).toBe(ManageCLIError.LifecycleWorkerReachedTimeout.code);
        expect(actual_error.message).toBe(ManageCLIError.LifecycleWorkerReachedTimeout.message);
    });
});

describe('noobaa nc - lifecycle batching', () => {
    describe('noobaa nc - lifecycle batching - bucket batch size is bigger than list batch size', () => {
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
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 5, // bucket batch size is bigger than list batch size
            }));
        });

        afterEach(async () => {
            await object_sdk.delete_bucket_lifecycle({ name: test_bucket });
            await fs_utils.create_fresh_path(test_bucket_path);
            fs_utils.folder_delete(tmp_lifecycle_logs_dir_path);
            await config_fs.delete_config_json_file();
        });

        it("lifecycle batching - no lifecycle rules", async () => {
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
        });

        it("lifecycle batching - with lifecycle rule, one batch of bucket and list", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

            await create_object(object_sdk, test_bucket, test_key1, 100, true);
            await create_object(object_sdk, test_bucket, test_key2, 100, true);
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
            Object.values(parsed_res_latest_lifecycle.response.reply.buckets_statuses).forEach(bucket_status => {
                expect(bucket_status.state.is_finished).toBe(true);
                Object.values(bucket_status.rules_statuses).forEach(rule_status => {
                    expect(rule_status.state.is_finished).toBe(true);
                });
            });
        });

        it("lifecycle batching - with lifecycle rule, one batch of bucket and list, no expire statement", async () => {
            const lifecycle_rule = [{
                "id": "abort mpu after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
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
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
            Object.values(parsed_res_latest_lifecycle.response.reply.buckets_statuses).forEach(bucket_status => {
                expect(bucket_status.state.is_finished).toBe(true);
            });
        }, TEST_TIMEOUT);

        it("lifecycle batching - with lifecycle rule, multiple list batches, one bucket batch", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

            await create_object(object_sdk, test_bucket, test_key1, 100, true);
            await create_object(object_sdk, test_bucket, test_key2, 100, true);
            await create_object(object_sdk, test_bucket, "key3", 100, true);
            await create_object(object_sdk, test_bucket, "key4", 100, true);
            await create_object(object_sdk, test_bucket, "key5", 100, true);
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
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
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(0);
        });

        it("lifecycle batching - with lifecycle rule, multiple list batches, one bucket batch - worker did not finish", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

            await create_object(object_sdk, test_bucket, test_key1, 100, true);
            await create_object(object_sdk, test_bucket, test_key2, 100, true);

            await config_fs.update_config_json_file(JSON.stringify({
                // set short timeout so the lifecycle run will not finish
                NC_LIFECYCLE_TIMEOUT_MS: 1,
                // the configs as it was before (in the beforeEach)
                NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 5,
                NC_LIFECYCLE_LIST_BATCH_SIZE: 2
            }));
            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true, undefined);

            const lifecycle_log_entries = await nb_native().fs.readdir(config_fs.fs_context, tmp_lifecycle_logs_dir_path);
            expect(lifecycle_log_entries.length).toBe(1);
            const log_file_path = path.join(tmp_lifecycle_logs_dir_path, lifecycle_log_entries[0].name);
            const lifecycle_log_json = await config_fs.get_config_data(log_file_path, { silent_if_missing: true });
            expect(lifecycle_log_json.state.is_finished).toBe(false);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
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
            const lifecycle_log_json = await config_fs.get_config_data(log_file_path, { silent_if_missing: true });
            expect(lifecycle_log_json.state.is_finished).toBe(true);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(2);
        });

        it("continue lifecycle batching (running twice: worker not finish and continued worker) - should finish the run - delete all", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
            await config_fs.update_config_json_file(JSON.stringify({
                // set short timeout so the lifecycle run will not finish
                NC_LIFECYCLE_TIMEOUT_MS: 5,
                // the configs as it was before (in the beforeEach)
                NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 5,
                NC_LIFECYCLE_LIST_BATCH_SIZE: 2

            }));
            const keys = [test_key1, test_key2, "key3", "key4", "key5", "key6", "key7"];
            for (const key of keys) {
                await create_object(object_sdk, test_bucket, key, 100, false);
            }
            try {
                await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            } catch (e) {
                //ignore timeout error
            }
            await config_fs.update_config_json_file(JSON.stringify({
                // set default timeout so the lifecycle run will continue to run
                NC_LIFECYCLE_TIMEOUT_MS: config.NC_LIFECYCLE_TIMEOUT_MS,
                // the configs as it was before (in the beforeEach)
                NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 5,
                NC_LIFECYCLE_LIST_BATCH_SIZE: 2

            }));
            await exec_manage_cli(TYPES.LIFECYCLE, '', { continue: 'true', disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(0);
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
                await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            } catch (e) {
                //ignore error
            }

            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
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
            await exec_manage_cli(TYPES.LIFECYCLE, '', { continue: 'true', disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list2 = await object_sdk.list_objects({ bucket: test_bucket });
            const res_keys = object_list2.objects.map(object => object.key);
            for (const key of new_keys) {
                expect(res_keys).toContain(key);
            }
        }, TEST_TIMEOUT);

        it("lifecycle batching - with lifecycle rule, multiple list batches, multiple bucket batches - newer noncurrent versions", async () => {
            const lifecycle_rule = [{
                "id": "keep 2 noncurrent versions",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": "",
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 2,
                    "noncurrent_days": 1
                }
            }];
            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            const version_arr = [];
            let res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
            version_arr.push(res.version_id);
            for (let i = 0; i < 9; i++) {
                const prev_res = res;
                res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
                await update_version_xattr(test_bucket, test_key1, prev_res.version_id);
                version_arr.push(res.version_id);
            }
            const last_3_versions = new Set(version_arr.slice(-3)); // latest version + 2 noncurrent versions
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);

            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            const object_list_versions = new Set(object_list.objects.map(object => object.version_id));
            expect(object_list.objects.length).toBe(3);
            expect(object_list_versions).toEqual(last_3_versions);
        });

        it("lifecycle rule, multiple list batches, multiple bucket batches - both expire and noncurrent actions", async () => {
            const lifecycle_rule = [{
                "id": "keep 2 noncurrent versions and expire after 1 day",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": "",
                },
                "expiration": {
                    "date": yesterday.getTime()
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 2,
                    "noncurrent_days": 1
                }
            }];
            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            const keys = [test_key1, test_key2, "key3", "key4", "key5", "key6", "key7"];
            for (const key of keys) {
                if (key === test_key1) continue; //test_key1 is initialized in his own loop
                await create_object(object_sdk, test_bucket, key, 100, false);
            }

            let prev_res;
            let res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
            for (let i = 0; i < 9; i++) {
                prev_res = res;
                res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
                await update_version_xattr(test_bucket, test_key1, prev_res.version_id);
            }
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);

            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            const expected_length = keys.length * 2 + 1; //all keys + delete marker for each key + 1 noncurrent versions for test_key1
            expect(object_list.objects.length).toBe(expected_length);
        });
    });

    describe('noobaa nc - lifecycle batching - bucket batch size is smaller than list batch size', () => {
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
                NC_LIFECYCLE_LIST_BATCH_SIZE: 5,
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 2, // bucket batch size is smaller than list batch size
            }));
        });

        afterEach(async () => {
            await object_sdk.delete_bucket_lifecycle({ name: test_bucket });
            await fs_utils.create_fresh_path(test_bucket_path);
            fs_utils.folder_delete(tmp_lifecycle_logs_dir_path);
            await config_fs.delete_config_json_file();
        });

        it("lifecycle batching - no lifecycle rules", async () => {
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
        });

        it("lifecycle batching - with lifecycle rule, one batch of bucket and list", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

            await create_object(object_sdk, test_bucket, test_key1, 100, true);
            await create_object(object_sdk, test_bucket, test_key2, 100, true);
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
            Object.values(parsed_res_latest_lifecycle.response.reply.buckets_statuses).forEach(bucket_status => {
                expect(bucket_status.state.is_finished).toBe(true);
                Object.values(bucket_status.rules_statuses).forEach(rule_status => {
                    expect(rule_status.state.is_finished).toBe(true);
                });
            });
        });

        it("lifecycle batching - with lifecycle rule, one batch of bucket and list, no expire statement", async () => {
            const lifecycle_rule = [{
                "id": "abort mpu after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
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
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
            Object.values(parsed_res_latest_lifecycle.response.reply.buckets_statuses).forEach(bucket_status => {
                expect(bucket_status.state.is_finished).toBe(true);
            });
        });

        it("lifecycle batching - with lifecycle rule, one list batch, multiple bucket batches", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

            await create_object(object_sdk, test_bucket, test_key1, 100, true);
            await create_object(object_sdk, test_bucket, test_key2, 100, true);
            await create_object(object_sdk, test_bucket, "key3", 100, true);
            await create_object(object_sdk, test_bucket, "key4", 100, true);
            await create_object(object_sdk, test_bucket, "key5", 100, true);
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
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
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(0);
        });

        it("lifecycle batching - with lifecycle rule, one list batch, multiple bucket batches - worker did not finish", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

            await create_object(object_sdk, test_bucket, test_key1, 100, true);
            await create_object(object_sdk, test_bucket, test_key2, 100, true);

            await config_fs.update_config_json_file(JSON.stringify({
                // set short timeout so the lifecycle run will not finish
                NC_LIFECYCLE_TIMEOUT_MS: 1,
                // the configs as it was before (in the beforeEach)
                NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 2,
                NC_LIFECYCLE_LIST_BATCH_SIZE: 5
            }));
            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true, undefined);

            const lifecycle_log_entries = await nb_native().fs.readdir(config_fs.fs_context, tmp_lifecycle_logs_dir_path);
            expect(lifecycle_log_entries.length).toBe(1);
            const log_file_path = path.join(tmp_lifecycle_logs_dir_path, lifecycle_log_entries[0].name);
            const lifecycle_log_json = await config_fs.get_config_data(log_file_path, { silent_if_missing: true });
            expect(lifecycle_log_json.state.is_finished).toBe(false);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
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
            const lifecycle_log_json = await config_fs.get_config_data(log_file_path, { silent_if_missing: true });
            expect(lifecycle_log_json.state.is_finished).toBe(true);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(2);
        });

        it("continue lifecycle batching (running twice: worker not finish and continued worker) - should finish the run - delete all", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
            await config_fs.update_config_json_file(JSON.stringify({
                // set short timeout so the lifecycle run will not finish
                NC_LIFECYCLE_TIMEOUT_MS: 5,
                // the configs as it was before (in the beforeEach)
                NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 2,
                NC_LIFECYCLE_LIST_BATCH_SIZE: 5

            }));
            const keys = [test_key1, test_key2, "key3", "key4", "key5", "key6", "key7"];
            for (const key of keys) {
                await create_object(object_sdk, test_bucket, key, 100, false);
            }
            try {
                await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            } catch (e) {
                //ignore timeout error
            }
            await config_fs.update_config_json_file(JSON.stringify({
                // set default timeout so the lifecycle run will continue to run
                NC_LIFECYCLE_TIMEOUT_MS: config.NC_LIFECYCLE_TIMEOUT_MS,
                // the configs as it was before (in the beforeEach)
                NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 2,
                NC_LIFECYCLE_LIST_BATCH_SIZE: 5

            }));
            await exec_manage_cli(TYPES.LIFECYCLE, '', { continue: 'true', disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(0);
        });

        it("continue lifecycle batching should finish the run - validate new run. don't delete already deleted items", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
            await config_fs.update_config_json_file(JSON.stringify({
                NC_LIFECYCLE_TIMEOUT_MS: 70,
                NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 2,
                NC_LIFECYCLE_LIST_BATCH_SIZE: 4
            }));
            const keys = [];
            for (let i = 0; i < 100; i++) {
                const new_key = `key${i}`;
                await create_object(object_sdk, test_bucket, new_key, 100, false);
                keys.push(new_key);
            }
            try {
                await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            } catch (e) {
                //ignore error
            }

            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
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
                NC_LIFECYCLE_BUCKET_BATCH_SIZE: 2,
                NC_LIFECYCLE_LIST_BATCH_SIZE: 4,
            }));
            await exec_manage_cli(TYPES.LIFECYCLE, '', { continue: 'true', disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list2 = await object_sdk.list_objects({ bucket: test_bucket });
            const res_keys = object_list2.objects.map(object => object.key);
            for (const key of new_keys) {
                expect(res_keys).toContain(key);
            }
        }, TEST_TIMEOUT);

        it("lifecycle batching - with lifecycle rule, multiple list batches, multiple bucket batches - newer noncurrent versions", async () => {
            const lifecycle_rule = [{
                "id": "keep 2 noncurrent versions",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": "",
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 2,
                    "noncurrent_days": 1
                }
            }];
            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            const version_arr = [];
            let res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
            version_arr.push(res.version_id);
            for (let i = 0; i < 9; i++) {
                const prev_res = res;
                res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
                await update_version_xattr(test_bucket, test_key1, prev_res.version_id);
                version_arr.push(res.version_id);
            }
            const last_3_versions = new Set(version_arr.slice(-3)); // latest version + 2 noncurrent versions
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);

            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            const object_list_versions = new Set(object_list.objects.map(object => object.version_id));
            expect(object_list.objects.length).toBe(3);
            expect(object_list_versions).toEqual(last_3_versions);
        });

        it("lifecycle rule, multiple list batches, multiple bucket batches - both expire and noncurrent actions", async () => {
            const lifecycle_rule = [{
                "id": "keep 2 noncurrent versions and expire after 1 day",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": "",
                },
                "expiration": {
                    "date": yesterday.getTime()
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 2,
                    "noncurrent_days": 1
                }
            }];
            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            const keys = [test_key1, test_key2, "key3", "key4", "key5", "key6", "key7"];
            for (const key of keys) {
                if (key === test_key1) continue; //test_key1 is initialized in his own loop
                await create_object(object_sdk, test_bucket, key, 100, false);
            }
            let prev_res;
            let res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
            for (let i = 0; i < 9; i++) {
                prev_res = res;
                res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
                await update_version_xattr(test_bucket, test_key1, prev_res.version_id);
            }
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);

            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            const expected_length = keys.length * 2 + 1; //all keys + delete marker for each key + 1 noncurrent versions for test_key1
            expect(object_list.objects.length).toBe(expected_length);
        });
    });

    describe('noobaa nc - lifecycle batching - thousands of objects', () => {
        const TEST_TIMEOUT_FOR_LONG_BATCHING = 120 * 1000;
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
                NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path
            }));
        });

        afterEach(async () => {
            await object_sdk.delete_bucket_lifecycle({ name: test_bucket });
            await fs_utils.create_fresh_path(test_bucket_path);
            fs_utils.folder_delete(tmp_lifecycle_logs_dir_path);
            await config_fs.delete_config_json_file();
        });

        it("lifecycle batching - with lifecycle rule, one batch of bucket and list", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

            for (let i = 0; i < 1000; i++) {
                await create_object(object_sdk, test_bucket, `test_key${i}`, 5, true);
            }
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
            Object.values(parsed_res_latest_lifecycle.response.reply.buckets_statuses).forEach(bucket_status => {
                expect(bucket_status.state.is_finished).toBe(true);
                Object.values(bucket_status.rules_statuses).forEach(rule_status => {
                    expect(rule_status.state.is_finished).toBe(true);
                });
            });
        }, TEST_TIMEOUT_FOR_LONG_BATCHING);

        it("lifecycle batching - with lifecycle rule, one batch of bucket and list, no expire statement", async () => {
            const lifecycle_rule = [{
                "id": "abort mpu after 3 days",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": '',
                },
                "abort_incomplete_multipart_upload": {
                    "days_after_initiation": 3
                }
            }];
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });
            for (let i = 0; i < 1000; i++) {
                await object_sdk.create_object_upload({ key: `test_key${i}`, bucket: test_bucket });
            }
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);
            Object.values(parsed_res_latest_lifecycle.response.reply.buckets_statuses).forEach(bucket_status => {
                expect(bucket_status.state.is_finished).toBe(true);
            });
        });

        it("lifecycle batching - with lifecycle rule, one list batches, one bucket batch - worker did not finish", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });

            for (let i = 0; i < 1000; i++) {
                await create_object(object_sdk, test_bucket, `test_key${i}`, 5, true);
            }

            await config_fs.update_config_json_file(JSON.stringify({
                // set short timeout so the lifecycle run will not finish
                NC_LIFECYCLE_TIMEOUT_MS: 1,
                // the configs as it was before (in the beforeEach)
                NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,
            }));
            await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true, undefined);

            const lifecycle_log_entries = await nb_native().fs.readdir(config_fs.fs_context, tmp_lifecycle_logs_dir_path);
            expect(lifecycle_log_entries.length).toBe(1);
            const log_file_path = path.join(tmp_lifecycle_logs_dir_path, lifecycle_log_entries[0].name);
            const lifecycle_log_json = await config_fs.get_config_data(log_file_path, { silent_if_missing: true });
            expect(lifecycle_log_json.state.is_finished).toBe(false);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).not.toBe(0);
        }, TEST_TIMEOUT_FOR_LONG_BATCHING);

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
            const lifecycle_log_json = await config_fs.get_config_data(log_file_path, { silent_if_missing: true });
            expect(lifecycle_log_json.state.is_finished).toBe(true);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(2);
        });

        it("continue lifecycle batching (running twice: worker not finish and continued worker) - should finish the run - delete all", async () => {
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
            await config_fs.update_config_json_file(JSON.stringify({
                // set short timeout so the lifecycle run will not finish
                NC_LIFECYCLE_TIMEOUT_MS: 5,
                // the configs as it was before (in the beforeEach)
                NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,

            }));
            for (let i = 0; i < 1000; i++) {
                await create_object(object_sdk, test_bucket, `test_key${i}`, 5, false);
            }
            try {
                await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            } catch (e) {
                //ignore timeout error
            }
            await config_fs.update_config_json_file(JSON.stringify({
                // set default timeout so the lifecycle run will continue to run
                NC_LIFECYCLE_TIMEOUT_MS: config.NC_LIFECYCLE_TIMEOUT_MS,
                // the configs as it was before (in the beforeEach)
                NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path,

            }));
            await exec_manage_cli(TYPES.LIFECYCLE, '', { continue: 'true', disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const object_list = await object_sdk.list_objects({ bucket: test_bucket });
            expect(object_list.objects.length).toBe(0);
        }, TEST_TIMEOUT_FOR_LONG_BATCHING);

        it("lifecycle batching - with lifecycle rule, multiple list batches, multiple bucket batches - newer noncurrent versions", async () => {
            const lifecycle_rule = [{
                "id": "keep 2 noncurrent versions",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": "",
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 2,
                    "noncurrent_days": 1
                }
            }];
            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            const version_arr = [];
            let res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
            version_arr.push(res.version_id);
            for (let i = 0; i < 1099; i++) {
                const prev_res = res;
                res = await create_object(object_sdk, test_bucket, test_key1, 100, false);
                await update_version_xattr(test_bucket, test_key1, prev_res.version_id);
                version_arr.push(res.version_id);
            }
            const last_3_versions = new Set(version_arr.slice(-3)); // latest version + 2 noncurrent versions
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);

            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            const object_list_versions = new Set(object_list.objects.map(object => object.version_id));
            expect(object_list.objects.length).toBe(3);
            expect(object_list_versions).toEqual(last_3_versions);
        }, TEST_TIMEOUT_FOR_LONG_BATCHING);

        it("lifecycle rule, multiple list batches, multiple bucket batches - both expire and noncurrent actions", async () => {
            const lifecycle_rule = [{
                "id": "keep 2 noncurrent versions and expire after 1 day",
                "status": LIFECYCLE_RULE_STATUS_ENUM.ENABLED,
                "filter": {
                    "prefix": "",
                },
                "expiration": {
                    "date": yesterday.getTime()
                },
                "noncurrent_version_expiration": {
                    "newer_noncurrent_versions": 2,
                    "noncurrent_days": 1
                }
            }];
            await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });
            await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule });

            const keys = [test_key1, test_key2, "key3", "key4", "key5", "key6", "key7"];
            for (const key of keys) {
                if (key === test_key1) continue; //test_key1 is initialized in his own loop
                await create_object(object_sdk, test_bucket, key, 10, false);
            }

            let prev_res;
            let res = await create_object(object_sdk, test_bucket, test_key1, 10, false);
            for (let i = 0; i < 1099; i++) {
                prev_res = res;
                res = await create_object(object_sdk, test_bucket, test_key1, 10, false);
                await update_version_xattr(test_bucket, test_key1, prev_res.version_id);
            }
            const latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, undefined, undefined);
            const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
            expect(parsed_res_latest_lifecycle.response.reply.state.is_finished).toBe(true);

            const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
            const expected_length = keys.length * 2 + 1; //all keys + delete marker for each key + 1 noncurrent versions for test_key1
            expect(object_list.objects.length).toBe(expected_length);
        }, TEST_TIMEOUT_FOR_LONG_BATCHING);
    });
});

describe('noobaa nc - lifecycle notifications', () => {
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
        agent_request_object: { "host": "localhost", "port": 9998, "timeout": 1500 },
        request_options_object: { "auth": "amit:passw", "timeout": 1500 },
        notification_protocol: 'http',
        name: 'http_notif'
    };

    const notifications_json = {
        bucket_name: test_bucket,
        notifications: [{
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

    it('nc lifecycle - lifecycle rule with Delete notification', async () => {
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
        await create_object(object_sdk, test_bucket, test_key1, 100, true);
        await create_object(object_sdk, test_bucket, test_key2, 100, true);
        await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true);

        const object_list = await object_sdk.list_objects({ bucket: test_bucket });
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

    it('nc lifecycle - lifecycle rule with Delete marker notification', async () => {
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
        await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });

        await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await create_object(object_sdk, test_bucket, test_key2, 100, false);
        await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true);

        const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
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

    it('nc lifecycle - should not notify', async () => {
        notifications_json.notifications[0].event = ["s3:LifecycleExpiration:Delete"];
        await object_sdk.put_bucket_notification(notifications_json);
        await object_sdk.set_bucket_lifecycle_configuration_rules({ name: test_bucket, rules: lifecycle_rule_delete_all });
        await object_sdk.set_bucket_versioning({ name: test_bucket, versioning: 'ENABLED' });

        await create_object(object_sdk, test_bucket, test_key1, 100, false);
        await create_object(object_sdk, test_bucket, test_key2, 100, false);

        await exec_manage_cli(TYPES.LIFECYCLE, '', { disable_service_validation: 'true', disable_runtime_validation: 'true', config_root }, true);
        await config_fs.delete_config_json_file();

        const object_list = await object_sdk.list_object_versions({ bucket: test_bucket });
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

/**
 * create_object creates an object with random data in the bucket
 * Note: is_old - if true, would update the mtime of the file.
 * @param {object} object_sdk
 * @param {string} bucket
 * @param {string} key
 * @param {number} size
 * @param {boolean} [is_old]
 * @param {{ key: string; value: string; }[]} [tagging]
 */
async function create_object(object_sdk, bucket, key, size, is_old, tagging) {
    const data = crypto.randomBytes(size);
    const res = await object_sdk.upload_object({
        bucket,
        key,
        source_stream: buffer_utils.buffer_to_read_stream(data),
        size,
        tagging
    });
    if (is_old) {
        await update_file_mtime(path.join(root_path, bucket, key));
        if (key.endsWith('/') === true) {
            await update_file_mtime(path.join(root_path, bucket, key, '.folder'));
        }
    }
    return res;
}

/**
 * updates the number of noncurrent days xattr of target path to be 5 days older. use only on noncurrent objects.
 * is use this function on latest object the xattr will be changed when the object turns noncurrent
 * how to use this function:
 * 1. create a new object but don't change its mtime (changing mtime will cause versioning functions to fail)
 * 2. create a new object with the same key to make the object noncurrent
 * 3. call this function to change the xattr of the noncurrent object
 * @param {String} bucket
 * @param {String} key
 * @param {String} version_id
 * @returns {Promise<Void>}
 */
async function update_version_xattr(bucket, key, version_id) {
    const older_time = new Date();
    older_time.setDate(yesterday.getDate() - 5); // 5 days ago

    const target_path = path.join(root_path, bucket, path.dirname(key), '.versions', `${path.basename(key)}_${version_id}`);
    const file = await nb_native().fs.open(config_fs.fs_context, target_path, config.NSFS_OPEN_READ_MODE,
        native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE));
    const stat = await file.stat(config_fs.fs_context);
    const xattr = Object.assign(stat.xattr, {
        'user.noobaa.non_current_timestamp': older_time.getTime(),
    });
    await file.replacexattr(config_fs.fs_context, xattr, undefined);
    await file.close(config_fs.fs_context);
}

/**
 * date_to_run_time_format coverts a date to run time format HH:MM
 * @param {Date} date
 * @returns {String}
 */
function date_to_run_time_format(date = new Date()) {
    return date.getHours() + ':' + date.getMinutes();
}
