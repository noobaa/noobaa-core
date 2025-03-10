/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const path = require('path');
const fs_utils = require('../../../util/fs_utils');
const { ConfigFS } = require('../../../sdk/config_fs');
const { TMP_PATH, set_nc_config_dir_in_config, TEST_TIMEOUT, exec_manage_cli } = require('../../system_tests/test_utils');
const BucketSpaceFS = require('../../../sdk/bucketspace_fs');
const { TYPES, ACTIONS } = require('../../../manage_nsfs/manage_nsfs_constants');
const NamespaceFS = require('../../../sdk/namespace_fs');
const endpoint_stats_collector = require('../../../sdk/endpoint_stats_collector');
const os_utils = require('../../../util/os_utils');
const buffer_utils = require('../../../util/buffer_utils');
const crypto = require('crypto');

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
    const account_options1 = {uid: 2002, gid: 2002, new_buckets_path: root_path, name: 'user2', config_root, allow_bucket_creation: "true"};
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
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: "true", config_root}, undefined, undefined);
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
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: "true", config_root}, undefined, undefined);
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
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: "true", config_root}, undefined, undefined);
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

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: "true", config_root}, undefined, undefined);
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
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: "true", config_root}, undefined, undefined);
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
        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: "true", config_root}, undefined, undefined);
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

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: "true", config_root}, undefined, undefined);
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

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: "true", config_root}, undefined, undefined);
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

        await exec_manage_cli(TYPES.LIFECYCLE, '', {disable_service_validation: "true", config_root}, undefined, undefined);
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

async function update_file_mtime(target_path) {
    const update_file_mtime_cmp = `touch -d "5 days ago" ${target_path}`;
    await os_utils.exec(update_file_mtime_cmp, { return_stdout: true });
}
