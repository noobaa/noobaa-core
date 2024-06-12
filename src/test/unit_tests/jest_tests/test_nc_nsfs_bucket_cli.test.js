/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const fs = require('fs');
const path = require('path');
const os_util = require('../../../util/os_utils');
const fs_utils = require('../../../util/fs_utils');
const nb_native = require('../../../util/nb_native');
const { set_path_permissions_and_owner, TMP_PATH, generate_s3_policy,
    set_nc_config_dir_in_config } = require('../../system_tests/test_utils');
const { ACTIONS, TYPES, CONFIG_SUBDIRS } = require('../../../manage_nsfs/manage_nsfs_constants');
const { get_process_fs_context, is_path_exists, get_bucket_tmpdir_full_path } = require('../../../util/native_fs_utils');
const ManageCLIError = require('../../../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const { ManageCLIResponse } = require('../../../manage_nsfs/manage_nsfs_cli_responses');

const tmp_fs_path = path.join(TMP_PATH, 'test_nc_nsfs_bucket_cli');
const DEFAULT_FS_CONFIG = get_process_fs_context();

let account_id;

// eslint-disable-next-line max-lines-per-function
describe('manage nsfs cli bucket flow', () => {

    describe('cli create bucket', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
        const bucket_storage_path = path.join(tmp_fs_path, 'root_path_manage_nsfs', 'bucket1');
        set_nc_config_dir_in_config(config_root);

        const account_defaults = {
            name: 'account_test',
            new_buckets_path: `${root_path}new_buckets_path_user1/`,
            uid: 1001,
            gid: 1001,
            access_key: 'GIGiFAnjaaE7OKD5N7hX',
            secret_key: 'G2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        };

        const bucket_defaults = {
            name: 'bucket1',
            owner: account_defaults.name,
            path: bucket_storage_path,
        };

        beforeEach(async () => {
            await fs_utils.create_fresh_path(`${config_root}/${CONFIG_SUBDIRS.BUCKETS}`);
            await fs_utils.create_fresh_path(root_path);
            await fs_utils.create_fresh_path(bucket_storage_path);
            // account add
            const { new_buckets_path: account_path } = account_defaults;
            const account_options = { config_root, ...account_defaults };
            await fs_utils.create_fresh_path(account_path);
            await fs_utils.file_must_exist(account_path);
            await set_path_permissions_and_owner(account_path, account_options, 0o700);
            account_id = await create_account_and_get_id(account_options);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('should fail - cli create bucket - invalid option type (path as number)', async () => {
            const action = ACTIONS.ADD;
            const path_invalid = 4e34; // invalid should be string represents a path
            const bucket_options = { config_root, ...bucket_defaults, path: path_invalid };
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
        });

        it('should fail - cli create bucket - invalid option type (path as string)', async () => {
            const action = ACTIONS.ADD;
            const path_invalid = 'aaa'; // invalid should be string represents a path
            const bucket_options = { config_root, ...bucket_defaults, path: path_invalid };
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidStoragePath.message);
        });

        it('cli create bucket use flag force_md5_etag', async () => {
            const action = ACTIONS.ADD;
            const force_md5_etag = 'true';
            const bucket_options = { config_root, ...bucket_defaults, force_md5_etag };
            await fs_utils.create_fresh_path(bucket_options.path);
            await fs_utils.file_must_exist(bucket_options.path);
            await set_path_permissions_and_owner(bucket_options.path, account_defaults, 0o700);
            await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name);
            expect(bucket.force_md5_etag).toBe(true);
        });

        it('should fail - cli create bucket - owner does not have any permission to path', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { config_root, ...bucket_defaults};
            await fs_utils.create_fresh_path(bucket_options.path);
            await fs_utils.file_must_exist(bucket_options.path);
            await set_path_permissions_and_owner(bucket_options.path, account_defaults, 0o077);
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InaccessibleStoragePath.code);
        });

        it('should fail - cli create bucket - owner does not have write permission to path', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { config_root, ...bucket_defaults};
            await fs_utils.create_fresh_path(bucket_options.path);
            await fs_utils.file_must_exist(bucket_options.path);
            await set_path_permissions_and_owner(bucket_options.path, account_defaults, 0o477);
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InaccessibleStoragePath.code);
        });

        it('should fail - cli create bucket - owner does not have read permission to path', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { config_root, ...bucket_defaults};
            await fs_utils.create_fresh_path(bucket_options.path);
            await fs_utils.file_must_exist(bucket_options.path);
            await set_path_permissions_and_owner(bucket_options.path, account_defaults, 0o277);
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InaccessibleStoragePath.code);
        });

        it('cli create bucket - account can access path', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { config_root, ...bucket_defaults};
            await fs_utils.create_fresh_path(bucket_options.path);
            await fs_utils.file_must_exist(bucket_options.path);
            await set_path_permissions_and_owner(bucket_options.path, account_defaults, 0o700);
            await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name);
            assert_bucket(bucket, bucket_options, account_id);
        });

        it('cli create bucket - account can not access path  NC_DISABLE_ACCESS_CHECK = true - should succeed', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { config_root, ...bucket_defaults};
            await fs_utils.create_fresh_path(bucket_options.path);
            await fs_utils.file_must_exist(bucket_options.path);
            set_nc_config_dir_in_config(config_root);
            await create_json_file(config_root, 'config.json', { NC_DISABLE_ACCESS_CHECK: true });
            await set_path_permissions_and_owner(bucket_options.path, account_defaults, 0o000);
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res).response.code).toEqual(ManageCLIResponse.BucketCreated.code);
        });

        it('cli create bucket - owner has iam_operate_on_root_account true', async () => {
            // update the account to have iam_operate_on_root_account true
            const { name } = account_defaults;
            const account_options = { config_root, name, iam_operate_on_root_account: 'true'};
            let action = ACTIONS.UPDATE;
            await exec_manage_cli(TYPES.ACCOUNT, action, account_options);

            // create the bucket
            action = ACTIONS.ADD;
            const bucket_options = { config_root, ...bucket_defaults};
            await fs_utils.create_fresh_path(bucket_options.path);
            await fs_utils.file_must_exist(bucket_options.path);
            await set_path_permissions_and_owner(bucket_options.path, account_defaults, 0o700);
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res).response.code).toEqual(ManageCLIResponse.BucketCreated.code);
        });

        it('should fail - cli bucket add - without identifier', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { config_root, owner: bucket_defaults.owner, path: bucket_defaults.path };
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.MissingBucketNameFlag.code);
        });

        it('should fail - cli create bucket - owner is an IAM account', async () => {
            const { new_buckets_path: account_path } = account_defaults;
            const account_name = 'account-to-be-owned';
            const account_options1 = { config_root, name: account_defaults.name, uid: 5555, gid: 5555,
                new_buckets_path: account_path, iam_name: account_name};
            await fs_utils.create_fresh_path(account_path);
            await fs_utils.file_must_exist(account_path);
            await set_path_permissions_and_owner(account_path, account_options1, 0o700);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, account_options1);

            // create the bucket
            const action = ACTIONS.ADD;
            const bucket_options = { config_root, ...bucket_defaults, owner: account_name};
            await fs_utils.create_fresh_path(bucket_options.path);
            await fs_utils.file_must_exist(bucket_options.path);
            await set_path_permissions_and_owner(bucket_options.path, { uid: account_options1.uid, gid: account_options1.gid }, 0o700);
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            //the requesting account is not root, so we couldn't find it.
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.BucketSetForbiddenBucketOwnerNotExists.code);
        });
    });

    describe('cli create bucket using from_file', () => {
        const type = TYPES.BUCKET;
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs1');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs1/');
        const bucket_storage_path = path.join(tmp_fs_path, 'root_path_manage_nsfs1', 'bucket1');
        const path_to_json_bucket_options_dir = path.join(tmp_fs_path, 'options');
        set_nc_config_dir_in_config(config_root);

        const account_name = 'account_test';
        const account_defaults = {
            name: account_name,
            new_buckets_path: `${root_path}new_buckets_path_3/`,
            uid: 1001,
            gid: 1001,
        };

        const bucket_defaults = {
            name: 'bucket1',
            owner: account_name,
            path: bucket_storage_path,
        };

        beforeEach(async () => {
            await fs_utils.create_fresh_path(`${config_root}/${CONFIG_SUBDIRS.BUCKETS}`);
            await fs_utils.create_fresh_path(root_path);
            await fs_utils.create_fresh_path(bucket_storage_path);
            await fs_utils.create_fresh_path(path_to_json_bucket_options_dir);
            // account add
            const { new_buckets_path: account_path } = account_defaults;
            const account_options = { config_root, ...account_defaults };
            await fs_utils.create_fresh_path(account_path);
            await fs_utils.file_must_exist(account_path);
            await set_path_permissions_and_owner(account_path, account_options, 0o700);
            account_id = await create_account_and_get_id(account_options);
            // give permission on bucket path to bucket owner 
            const { path: bucket_path } = bucket_defaults;
            await fs_utils.create_fresh_path(bucket_path);
            await fs_utils.file_must_exist(bucket_path);
            await set_path_permissions_and_owner(bucket_path, account_options, 0o700);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
            await fs_utils.folder_delete(`${path_to_json_bucket_options_dir}`);
        });

        it('cli create bucket using from_file with required options', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { name: bucket_defaults.name, owner: bucket_defaults.owner, path: bucket_defaults.path };
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_bucket_options(path_to_json_bucket_options_dir, bucket_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the bucket and check the details
            await exec_manage_cli(type, action, command_flags);
            // compare the details
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name);
            assert_bucket(bucket, bucket_options, account_id);
        });

        it('cli create bucket using from_file with optional options (fs_backend)', async () => {
            const action = ACTIONS.ADD;
            const fs_backend = 'GPFS';
            const bucket_options = { name: bucket_defaults.name, owner: bucket_defaults.owner, path: bucket_defaults.path,
                fs_backend: fs_backend };
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_bucket_options(path_to_json_bucket_options_dir, bucket_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the bucket and check the details
            await exec_manage_cli(type, action, command_flags);
            // compare the details
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name);
            assert_bucket(bucket, bucket_options, account_id);
            expect(bucket.fs_backend).toEqual(bucket_options.fs_backend);
        });

        it('cli create bucket using from_file with optional options (bucket_policy)', async () => {
            const action = ACTIONS.ADD;
            const bucket_policy = generate_s3_policy('*', bucket_defaults.name, ['s3:*']).policy;
            const bucket_options = { name: bucket_defaults.name, owner: bucket_defaults.owner, path: bucket_defaults.path,
                bucket_policy: bucket_policy };
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_bucket_options(path_to_json_bucket_options_dir, bucket_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the bucket and check the details
            await exec_manage_cli(type, action, command_flags);
            // compare the details
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name);
            assert_bucket(bucket, bucket_options, account_id);
            expect(bucket.bucket_policy).toEqual(bucket_options.s3_policy);
        });

        it('should fail - cli create bucket using from_file with additional flags (name)', async () => {
            const action = ACTIONS.ADD;
            const name = bucket_defaults.name;
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_bucket_options(path_to_json_bucket_options_dir, bucket_defaults);
            const command_flags = {config_root, from_file: path_to_option_json_file_name, name }; // name should be in file only
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create bucket using from_file with invalid option (lala) in the file', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { name: bucket_defaults.name, owner: bucket_defaults.owner, path: bucket_defaults.path, lala: 'lala'}; // lala invalid option
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_bucket_options(path_to_json_bucket_options_dir, bucket_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name };
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create bucket using from_file with invalid option (creation_date) in the file', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { name: bucket_defaults.name, owner: bucket_defaults.owner, path: bucket_defaults.path,
                creation_date: new Date().toISOString()}; // creation_date invalid option (user cannot set it)
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_bucket_options(path_to_json_bucket_options_dir, bucket_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name };
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create bucket using from_file with from_file inside the JSON file', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { name: bucket_defaults.name, owner: bucket_defaults.owner, path: bucket_defaults.path,
                from_file: 'blabla' }; //from_file inside options JSON file
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_bucket_options(path_to_json_bucket_options_dir, bucket_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name };
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create bucket using from_file with invalid option type (in the file)', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { name: bucket_defaults.name, owner: 1234, path: bucket_defaults.path }; // owner should be string (not number)
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_bucket_options(path_to_json_bucket_options_dir, bucket_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name };
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgumentType.code);
        });

        it('should fail - cli create bucket using from_file with invalid path', async () => {
            const action = ACTIONS.ADD;
            const command_flags = {config_root, from_file: 'blabla'}; //invalid path 
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidFilePath.code);
        });

        it('should fail - cli create bucket using from_file with invalid JSON file', async () => {
            const action = ACTIONS.ADD;
            const bucket_options = { name: bucket_defaults.name, owner: bucket_defaults.owner, path: bucket_defaults.path };
            // write invalid json_file_options
            const option_json_file_name = `${bucket_options.name}_options.json`;
            const path_to_option_json_file_name = path.join(path_to_json_bucket_options_dir, option_json_file_name);
            const content = JSON.stringify(bucket_options) + 'blabla'; // invalid JSON
            await fs.promises.writeFile(path_to_option_json_file_name, content);
            // write the json_file_options
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the bucket
            await exec_manage_cli(type, action, command_flags);
            // compare the details
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidJSONFile.code);
        });

    });

    describe('cli update bucket', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs2');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs2/');
        const bucket_storage_path = path.join(tmp_fs_path, 'root_path_manage_nsfs2', 'bucket1');
        set_nc_config_dir_in_config(config_root);

        const account_name = 'account_test';
        const account_name2 = 'account_test_update2';

        const account_defaults = {
            name: account_name,
            new_buckets_path: `${root_path}new_buckets_path_4/`,
            uid: 1001,
            gid: 1001,
        };

        const account_defaults2 = {
            name: account_name2,
            new_buckets_path: `${root_path}new_buckets_path_user41/`,
            uid: 1002,
            gid: 1002,
        };

        const bucket_defaults = {
            name: 'bucket1',
            owner: account_name,
            path: bucket_storage_path,
        };

        beforeEach(async () => {
            await fs_utils.create_fresh_path(`${config_root}/${CONFIG_SUBDIRS.BUCKETS}`);
            await fs_utils.create_fresh_path(root_path);
            await fs_utils.create_fresh_path(bucket_storage_path);
            const action = ACTIONS.ADD;
            // account add 1
            let { new_buckets_path: account_path } = account_defaults;
            let account_options = { config_root, ...account_defaults };
            await fs_utils.create_fresh_path(account_path);
            await fs_utils.file_must_exist(account_path);
            await set_path_permissions_and_owner(account_path, account_options, 0o700);
            await exec_manage_cli(TYPES.ACCOUNT, action, account_options);

            // account add 2
            account_path = account_defaults2.new_buckets_path;
            account_options = { config_root, ...account_defaults2 };
            await fs_utils.create_fresh_path(account_path);
            await fs_utils.file_must_exist(account_path);
            await set_path_permissions_and_owner(account_path, account_options, 0o700);
            account_id = await create_account_and_get_id(account_options);

            // bucket add
            const { path: bucket_path } = bucket_defaults;
            const bucket_options = { config_root, ...bucket_defaults };
            await fs_utils.create_fresh_path(bucket_path);
            await fs_utils.file_must_exist(bucket_path);
            await set_path_permissions_and_owner(bucket_path, account_defaults, 0o700);
            const resp = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            const bucket_resp = JSON.parse(resp);
            expect(bucket_resp.response.reply._id).not.toBeNull();
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli update bucket set force_md5_etag', async () => {
            const action = ACTIONS.UPDATE;
            const force_md5_etag = 'true';
            const bucket_options = { config_root, name: bucket_defaults.name, force_md5_etag };
            await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            let bucket_config = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name);
            expect(bucket_config.force_md5_etag).toBe(true);

            bucket_options.force_md5_etag = 'false';
            await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            bucket_config = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name);
            expect(bucket_config.force_md5_etag).toBe(false);
        });

        it('cli update bucket unset flag force_md5_etag', async function() {
            // first set the value of force_md5_etag to be true
            const action = ACTIONS.UPDATE;
            const force_md5_etag = 'true';
            const bucket_options = { config_root, name: bucket_defaults.name, force_md5_etag };
            await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            let bucket_config = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name);
            expect(bucket_config.force_md5_etag).toBe(true);

            // unset force_md5_etag
            const empty_string = '\'\'';
            bucket_options.force_md5_etag = empty_string;
            await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            bucket_config = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name);
            expect(bucket_config.force_md5_etag).toBeUndefined();
        });

        it('should fail - cli update bucket without a property to update', async () => {
            const action = ACTIONS.UPDATE;
            const account_options = { config_root, name: bucket_defaults.name };
            const res = await exec_manage_cli(TYPES.BUCKET, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.MissingUpdateProperty.message);
        });

        it('should fail - cli update bucket owner - owner does not have any permission to path', async () => {
            const action = ACTIONS.UPDATE;
            const bucket_options = { config_root, name: bucket_defaults.name, owner: account_defaults2.name};
            await fs_utils.create_fresh_path(bucket_defaults.path);
            await fs_utils.file_must_exist(bucket_defaults.path);
            await set_path_permissions_and_owner(bucket_defaults.path, account_defaults2, 0o077);
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InaccessibleStoragePath.code);
        });

        it('should fail - cli update bucket owner - owner does not have write permission to path', async () => {
            const action = ACTIONS.UPDATE;
            const bucket_options = { config_root, name: bucket_defaults.name, owner: account_defaults2.name};
            await fs_utils.create_fresh_path(bucket_defaults.path);
            await fs_utils.file_must_exist(bucket_defaults.path);
            await set_path_permissions_and_owner(bucket_defaults.path, account_defaults2, 0o477);
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InaccessibleStoragePath.code);
        });

        it('should fail - cli update bucket owner - owner does not have read permission to path', async () => {
            const action = ACTIONS.UPDATE;
            const bucket_options = { config_root, name: bucket_defaults.name, owner: account_defaults2.name};
            await fs_utils.create_fresh_path(bucket_defaults.path);
            await fs_utils.file_must_exist(bucket_defaults.path);
            await set_path_permissions_and_owner(bucket_defaults.path, account_defaults2, 0o277);
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InaccessibleStoragePath.code);
        });

        it('cli update bucket owner - account can access path', async () => {
            const action = ACTIONS.UPDATE;
            const bucket_options = { config_root, name: bucket_defaults.name, owner: account_defaults2.name};
            await fs_utils.create_fresh_path(bucket_defaults.path);
            await fs_utils.file_must_exist(bucket_defaults.path);
            await set_path_permissions_and_owner(bucket_defaults.path, account_defaults2, 0o700);
            await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name);
            expect(bucket.owner_account).toBe(account_id);
        });

        it('should fail - cli bucket update - without identifier', async () => {
            const action = ACTIONS.UPDATE;
            const bucket_options = { config_root };
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.MissingBucketNameFlag.code);
        });

        it('cli update bucket owner - owner has iam_operate_on_root_account true', async () => {
            // update the account to have iam_operate_on_root_account true
            const { name } = account_defaults2;
            const account_options = { config_root, name, iam_operate_on_root_account: 'true'};
            let action = ACTIONS.UPDATE;
            await exec_manage_cli(TYPES.ACCOUNT, action, account_options);

            action = ACTIONS.UPDATE;
            const bucket_options = { config_root, name: bucket_defaults.name, owner: account_defaults2.name};
            await fs_utils.create_fresh_path(bucket_defaults.path);
            await fs_utils.file_must_exist(bucket_defaults.path);
            await set_path_permissions_and_owner(bucket_defaults.path, account_defaults2, 0o700);
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res).response.code).toEqual(ManageCLIResponse.BucketUpdated.code);
        });

        it('should fail - cli update bucket - owner is an IAM account', async () => {
            const { new_buckets_path: account_path } = account_defaults;
            const account_name_iam_account = 'account-to-be-owned';
            const account_options1 = { config_root, name: account_defaults.name,
                iam_name: account_name_iam_account, uid: 5555, gid: 5555,
                new_buckets_path: account_path};
            await fs_utils.create_fresh_path(account_path);
            await fs_utils.file_must_exist(account_path);
            await set_path_permissions_and_owner(account_path, account_options1, 0o700);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, account_options1);

            // update the bucket
            const action = ACTIONS.UPDATE;
            const bucket_options = { config_root, name: bucket_defaults.name, owner: account_name_iam_account};
            await fs_utils.create_fresh_path(bucket_defaults.path);
            await fs_utils.file_must_exist(bucket_defaults.path);
            await set_path_permissions_and_owner(bucket_defaults.path, account_options1, 0o700);
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.BucketSetForbiddenBucketOwnerNotExists.code);
        });
    });

    describe('cli delete bucket', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs3');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs3/');
        const bucket_storage_path = path.join(tmp_fs_path, 'root_path_manage_nsfs3', 'bucket1');
        set_nc_config_dir_in_config(config_root);

        let bucket_temp_dir_path;
        const account_name = 'account_test';
        const account_defaults = {
            name: account_name,
            new_buckets_path: `${root_path}new_buckets_path_user2/`,
            uid: 999,
            gid: 999,
            access_key: 'GIGiFAnjaaE7OKD5N7hX',
            secret_key: 'G2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        };

        const bucket_defaults = {
            name: 'bucket1',
            owner: account_name,
            path: bucket_storage_path,
        };

        beforeEach(async () => {
            await fs_utils.create_fresh_path(`${config_root}/${CONFIG_SUBDIRS.BUCKETS}`);
            await fs_utils.create_fresh_path(root_path);
            await fs_utils.create_fresh_path(bucket_storage_path);
            const action = ACTIONS.ADD;
            // account add
            const { new_buckets_path: account_path } = account_defaults;
            const account_options = { config_root, ...account_defaults };
            await fs_utils.create_fresh_path(account_path);
            await fs_utils.file_must_exist(account_path);
            await set_path_permissions_and_owner(account_path, account_options, 0o700);
            account_id = await create_account_and_get_id(account_options);

            // bucket add
            const { path: bucket_path } = bucket_defaults;
            const bucket_options = { config_root, ...bucket_defaults };
            await fs_utils.create_fresh_path(bucket_path);
            await fs_utils.file_must_exist(bucket_path);
            await set_path_permissions_and_owner(bucket_path, account_options, 0o700);
            const resp = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            const bucket_resp = JSON.parse(resp);
            expect(bucket_resp.response.reply._id).not.toBeNull();

            // create temp dir
            bucket_temp_dir_path = get_bucket_tmpdir_full_path(bucket_storage_path, bucket_resp.response.reply._id);
            await fs_utils.create_fresh_path(bucket_temp_dir_path);
            await fs_utils.file_must_exist(bucket_temp_dir_path);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli delete bucket and delete temp dir', async () => {
            let path_exists = await is_path_exists(DEFAULT_FS_CONFIG, bucket_temp_dir_path);
            expect(path_exists).toBe(true);
            const bucket_options = { config_root, name: 'bucket1'};
            const action = ACTIONS.DELETE;
            await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            path_exists = await is_path_exists(DEFAULT_FS_CONFIG, bucket_temp_dir_path);
            expect(path_exists).toBe(false);
        });

        it('cli delete bucket with force flag, when bucket path is not empty', async () => {
            //here a dummy file is creating in bucket storage location(bucket_defaults.path) 
            await create_json_file(bucket_defaults.path, 'test.json', {test: 'data'});
            const delete_bucket_options = { config_root, name: bucket_defaults.name, force: true};
            const resp = await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, delete_bucket_options);
            expect(JSON.parse(resp.trim()).response.code).toBe(ManageCLIResponse.BucketDeleted.code);
            const config_path = path.join(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name + '.json');
            await fs_utils.file_must_not_exist(config_path);
        });

        it('should fail - cli delete bucket when bucket path is not empty', async () => {
            //here a dummy file is creating in bucket storage location(bucket_defaults.path), 
            await create_json_file(bucket_defaults.path, 'test1.json', {test: 'data'});
            const delete_bucket_options = { config_root, name: bucket_defaults.name};
            const resp = await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, delete_bucket_options);
            expect(JSON.parse(resp.stdout).error.code).toBe(ManageCLIError.BucketDeleteForbiddenHasObjects.code);
            const config_path = path.join(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name + '.json');
            await fs_utils.file_must_exist(config_path);
        });

        it('cli delete bucket force flag with valid boolean string(\'true\')', async () => {
            //here a dummy file is creating in bucket storage location(bucket_defaults.path) 
            await create_json_file(bucket_defaults.path, 'test.json', {test: 'data'});
            // force wth valid string value 'true'
            const delete_bucket_options = { config_root, name: bucket_defaults.name, force: 'true'};
            const resp = await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, delete_bucket_options);
            expect(JSON.parse(resp.trim()).response.code).toBe(ManageCLIResponse.BucketDeleted.code);
            const config_path = path.join(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name + '.json');
            await fs_utils.file_must_not_exist(config_path);
        });

        it('should fail - cli delete bucket force flag with invalid boolean string(\'nottrue\')', async () => {
            const delete_bucket_options = { config_root, name: bucket_defaults.name, force: 'nottrue'};
            const resp = await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, delete_bucket_options);
            expect(JSON.parse(resp.stdout).error.code).toBe(ManageCLIError.InvalidBooleanValue.code);
        });

        it('should fail - cli bucket delete - without identifier', async () => {
            const action = ACTIONS.DELETE;
            const bucket_options = { config_root };
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.MissingBucketNameFlag.code);
        });

        it('cli delete bucket when path was deleted first', async () => {
            await fs_utils.folder_delete(`${bucket_defaults.path}`);
            const path_exists = await is_path_exists(DEFAULT_FS_CONFIG, bucket_defaults.path);
            expect(path_exists).toBe(false);
            const bucket_options = { config_root, name: 'bucket1'};
            const action = ACTIONS.DELETE;
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.trim()).response.code).toBe(ManageCLIResponse.BucketDeleted.code);
            const config_path = path.join(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_defaults.name + '.json');
            await fs_utils.file_must_not_exist(config_path);
        });
    });

    describe('cli status bucket ', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs4');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs4/');
        const bucket_storage_path = path.join(tmp_fs_path, 'root_path_manage_nsfs4', 'bucket1');
        set_nc_config_dir_in_config(config_root);

        const account_name = 'account_test';
        const account_defaults = {
            name: account_name,
            new_buckets_path: `${root_path}new_buckets_path_user2/`,
            uid: 999,
            gid: 999,
            access_key: 'GIGiFAnjaaE7OKD5N7hX',
            secret_key: 'G2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        };

        const bucket_defaults = {
            name: 'bucket1',
            owner: account_name,
            path: bucket_storage_path,
        };

        beforeEach(async () => {
            await fs_utils.create_fresh_path(`${config_root}/${CONFIG_SUBDIRS.BUCKETS}`);
            await fs_utils.create_fresh_path(root_path);
            await fs_utils.create_fresh_path(bucket_storage_path);
            const action = ACTIONS.ADD;
            // account add
            const { new_buckets_path: account_path } = account_defaults;
            const account_options = { config_root, ...account_defaults };
            await fs_utils.create_fresh_path(account_path);
            await fs_utils.file_must_exist(account_path);
            await set_path_permissions_and_owner(account_path, account_options, 0o700);
            await exec_manage_cli(TYPES.ACCOUNT, action, account_options);

            // bucket add
            const { path: bucket_path } = bucket_defaults;
            const bucket_options = { config_root, ...bucket_defaults };
            await fs_utils.create_fresh_path(bucket_path);
            await fs_utils.file_must_exist(bucket_path);
            await set_path_permissions_and_owner(bucket_path, account_options, 0o700);
            const resp = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            const bucket_resp = JSON.parse(resp);
            expect(bucket_resp.response.reply._id).not.toBeNull();
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('should fail - cli bucket status - without identifier', async () => {
            const bucket_options = { config_root }; // without name
            const action = ACTIONS.STATUS;
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.MissingBucketNameFlag.code);
        });

    });

    describe('cli list bucket', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs5');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs5/');
        const bucket_storage_path = path.join(tmp_fs_path, 'root_path_manage_nsfs5', 'bucket1');
        set_nc_config_dir_in_config(config_root);

        const account_name = 'account_test';
        const account_defaults = {
            name: account_name,
            new_buckets_path: `${root_path}new_buckets_path_user2/`,
            uid: 999,
            gid: 999,
            access_key: 'GIGiFAnjaaE7OKD5N7hX',
            secret_key: 'G2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        };

        const bucket_defaults = {
            name: 'bucket1',
            owner: account_name,
            path: bucket_storage_path,
        };

        beforeEach(async () => {
            await fs_utils.create_fresh_path(`${config_root}/${CONFIG_SUBDIRS.BUCKETS}`);
            await fs_utils.create_fresh_path(root_path);
            await fs_utils.create_fresh_path(bucket_storage_path);
            const action = ACTIONS.ADD;
            // account add
            const { new_buckets_path: account_path } = account_defaults;
            const account_options = { config_root, ...account_defaults };
            await fs_utils.create_fresh_path(account_path);
            await fs_utils.file_must_exist(account_path);
            await set_path_permissions_and_owner(account_path, account_options, 0o700);
            await exec_manage_cli(TYPES.ACCOUNT, action, account_options);

            // bucket add
            const { path: bucket_path } = bucket_defaults;
            const bucket_options = { config_root, ...bucket_defaults };
            await fs_utils.create_fresh_path(bucket_path);
            await fs_utils.file_must_exist(bucket_path);
            await set_path_permissions_and_owner(bucket_path, account_options, 0o700);
            const resp = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            const bucket_resp = JSON.parse(resp);
            expect(bucket_resp.response.reply._id).not.toBeNull();
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli list filter by name (bucket2) - empty result', async () => {
            const bucket_options = { config_root, name: 'bucket2' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining([]));
        });

        it('cli list filter by name (bucket1)', async () => {
            const bucket_options = { config_root, name: 'bucket1' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.BUCKET, action, bucket_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['bucket1']));
        });

    });
});

/**
 * exec_manage_cli will get the flags for the cli and runs the cli with it's flags
 * @param {string} type
 * @param {string} action
 * @param {object} options
 */
async function exec_manage_cli(type, action, options) {
    let flags = ``;
    for (const key in options) {
        if (Object.hasOwn(options, key)) {
            if (typeof options[key] === 'boolean') {
                flags += `--${key} `;
            } else {
                flags += `--${key} ${options[key]} `;
            }
        }
    }
    flags = flags.trim();
    const command = `node src/cmd/manage_nsfs ${type} ${action} ${flags}`;

    let res;
    try {
        res = await os_util.exec(command, { return_stdout: true });
    } catch (e) {
        res = e;
    }
    return res;
}

/**
 * read_config_file will read the config files 
 * @param {string} config_root
 * @param {string} schema_dir 
 * @param {string} config_file_name the name of the config file
 * @param {boolean} [is_symlink] a flag to set the suffix as a symlink instead of json
 */
async function read_config_file(config_root, schema_dir, config_file_name, is_symlink) {
    const config_path = path.join(config_root, schema_dir, config_file_name + (is_symlink ? '.symlink' : '.json'));
    const { data } = await nb_native().fs.readFile(DEFAULT_FS_CONFIG, config_path);
    const config = JSON.parse(data.toString());
    return config;
}

/** 
 * create_json_bucket_options would create a JSON file with the options (key-value) inside file
 * @param {string} path_to_json_bucket_options_dir
 * @param {object} bucket_options
 */
async function create_json_bucket_options(path_to_json_bucket_options_dir, bucket_options) {
    const option_json_file_name = `${bucket_options.name}_options.json`;
    const path_to_option_json_file_name = await create_json_file(path_to_json_bucket_options_dir, option_json_file_name, bucket_options);
    return path_to_option_json_file_name;
}

/** 
 * create_json_file would create a JSON file with the data
 * @param {string} path_to_dir
 * @param {string} file_name
 * @param {object} data
 */
async function create_json_file(path_to_dir, file_name, data) {
    const path_to_option_json_file_name = path.join(path_to_dir, file_name);
    const content = JSON.stringify(data);
    await fs.promises.writeFile(path_to_option_json_file_name, content);
    return path_to_option_json_file_name;
}

/**
 * assert_bucket will verify the fields of the buckets (only required fields)
 * @param {object} bucket
 * @param {object} bucket_options
 */
function assert_bucket(bucket, bucket_options, owner_account_id) {
    expect(bucket.name).toEqual(bucket_options.name);
    expect(bucket.owner_account).toEqual(owner_account_id);
    expect(bucket.path).toEqual(bucket_options.path);
}

/**
 * Invoke cli to create an account, parses new account id from the response
 * @param {object} account
 */

async function create_account_and_get_id(account) {
    const res = JSON.parse(await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, account));
    return res.response.reply._id;
}
