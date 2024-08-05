/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 1200]*/
/*eslint max-statements: ["error", 90]*/
'use strict';

const _ = require('lodash');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const P = require('../../util/promise');
const config = require('../../../config');
const fs_utils = require('../../util/fs_utils');
const config_module = require('../../../config');
const nb_native = require('../../util/nb_native');
const { get_process_fs_context } = require('../../util/native_fs_utils');
const { ManageCLIError } = require('../../manage_nsfs/manage_nsfs_cli_errors');
const { ManageCLIResponse } = require('../../manage_nsfs/manage_nsfs_cli_responses');
const { exec_manage_cli, generate_s3_policy, create_fs_user_by_platform, delete_fs_user_by_platform,
    set_path_permissions_and_owner, TMP_PATH, set_nc_config_dir_in_config } = require('../system_tests/test_utils');
const { TYPES, ACTIONS, CONFIG_SUBDIRS } = require('../../manage_nsfs/manage_nsfs_constants');
const nc_mkm = require('../../manage_nsfs/nc_master_key_manager').get_instance();

const tmp_fs_path = path.join(TMP_PATH, 'test_bucketspace_fs');
const DEFAULT_FS_CONFIG = get_process_fs_context();

mocha.describe('manage_nsfs cli', function() {

    const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
    const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
    set_nc_config_dir_in_config(config_root);
    // TODO: needed for NC_CORETEST FLOW - should be handled better
    const nc_coretes_location = config.NC_MASTER_KEYS_FILE_LOCATION;
    mocha.before(async () => {
        await P.all(_.map([CONFIG_SUBDIRS.ACCOUNTS, CONFIG_SUBDIRS.BUCKETS, CONFIG_SUBDIRS.ACCESS_KEYS], async dir =>
            fs_utils.create_fresh_path(`${config_root}/${dir}`)));
        await fs_utils.create_fresh_path(root_path);
        config.NC_MASTER_KEYS_FILE_LOCATION = '';
    });
    mocha.after(async () => {
        await fs_utils.folder_delete(`${config_root}`);
        await fs_utils.folder_delete(`${root_path}`);
        await fs_utils.file_delete(path.join(config_root, 'master_keys.json'));
        config.NC_MASTER_KEYS_FILE_LOCATION = nc_coretes_location;
    });

    mocha.describe('cli bucket flow ', async function() {
        const type = TYPES.BUCKET;
        const account_name = 'user1';
        const account_name2 = 'user2';
        const name = 'bucket1';
        const bucket_on_gpfs = 'bucketgpfs1';
        const owner = account_name; // in a different variable for readability
        const bucket_path = `${root_path}${name}/`;
        const bucket_on_gpfs_path = `${root_path}${bucket_on_gpfs}/`;
        const bucket_with_policy = 'bucket-with-policy';
        const bucket_policy = generate_s3_policy('*', bucket_with_policy, ['s3:*']).policy;
        const bucket1_policy = generate_s3_policy('*', name, ['s3:*']).policy;
        const invalid_bucket_policy = generate_s3_policy('invalid_account', name, ['s3:*']).policy;
        const empty_bucket_policy = '';
        let add_res;
        let account_id;
        let account_id2;

        let bucket_options = { config_root, name, owner, path: bucket_path };
        const gpfs_bucket_options = { config_root, name: bucket_on_gpfs, owner, path: bucket_on_gpfs_path, fs_backend: 'GPFS' };
        const bucket_with_policy_options = { ...bucket_options, bucket_policy: bucket_policy, name: bucket_with_policy };

        const new_buckets_path1 = `${root_path}new_buckets_path_user1111/`;
        const new_buckets_path2 = `${root_path}new_buckets_path_user2222/`;
        const account_options1 = {
            config_root: config_root,
            name: account_name,
            new_buckets_path: new_buckets_path1,
            uid: 1111,
            gid: 1111,
        };
        const account_options2 = {
            config_root: config_root,
            name: account_name2,
            new_buckets_path: new_buckets_path2,
            uid: 2222,
            gid: 2222,
        };

        mocha.before(async () => {
            await P.all(_.map([CONFIG_SUBDIRS.ACCOUNTS, CONFIG_SUBDIRS.BUCKETS, CONFIG_SUBDIRS.ACCESS_KEYS], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
            await fs_utils.create_fresh_path(root_path);
        });
        mocha.after(async () => {
            await fs_utils.folder_delete(config_root);
            await fs_utils.folder_delete(root_path);
        });

        mocha.it('cli bucket create without existing account - should fail', async function() {
            const action = ACTIONS.ADD;
            try {
                await fs_utils.create_fresh_path(bucket_path);
                await fs_utils.file_must_exist(bucket_path);
                await exec_manage_cli(type, action, bucket_options);
                assert.fail('should have failed since the bucket owner does not exist');
            } catch (err) {
                assert_error(err, ManageCLIError.BucketSetForbiddenBucketOwnerNotExists);
            }
        });

        mocha.it('cli create account for bucket (bucket create requirement to have a bucket owner)', async function() {

            const action = ACTIONS.ADD;
            // create account 'user1'
            await fs_utils.create_fresh_path(new_buckets_path1);
            await fs_utils.file_must_exist(new_buckets_path1);
            await set_path_permissions_and_owner(new_buckets_path1, { uid: account_options1.uid, gid: account_options1.gid }, 0o700);
            account_id = JSON.parse(await exec_manage_cli(TYPES.ACCOUNT, action, account_options1)).response.reply._id;
            // create account 'user2'
            await fs_utils.create_fresh_path(new_buckets_path2);
            await fs_utils.file_must_exist(new_buckets_path2);
            await set_path_permissions_and_owner(new_buckets_path2, { uid: account_options2.uid, gid: account_options2.gid }, 0o700);
            account_id2 = JSON.parse(await exec_manage_cli(TYPES.ACCOUNT, action, account_options2)).response.reply._id;
        });

        mocha.it('cli bucket create - should fail bucket owner\'s allow_bucket_creation is false', async function() {
            const account_name_for_account_cannot_create_bucket = 'user3';
            const uid = 3333;
            const gid = 3333;

            const action = ACTIONS.ADD;
            // create account 'user3'
            // without new_buckets_path property 
            const account_options = {
                config_root: config_root,
                name: account_name_for_account_cannot_create_bucket,
                uid: uid,
                gid: gid,
            };
            await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            // try to create a bucket
            try {
                const bucket_options_with_owner_of_account_cannot_create_bucket = {
                     config_root,
                     name,
                     owner: account_name_for_account_cannot_create_bucket,
                     path: bucket_path
                };
                await fs_utils.create_fresh_path(bucket_path);
                await fs_utils.file_must_exist(bucket_path);
                await set_path_permissions_and_owner(bucket_path, account_options, 0o700);
                await exec_manage_cli(type, action, { ...bucket_options_with_owner_of_account_cannot_create_bucket });
                assert.fail('should have failed with not allowed to create new buckets');
            } catch (err) {
                assert_error(err, ManageCLIError.BucketCreationNotAllowed);
            }
        });

        mocha.it('cli bucket create with invalid bucket policy - should fail', async function() {
            const action = ACTIONS.ADD;
            try {
                await fs_utils.create_fresh_path(bucket_path);
                await fs_utils.file_must_exist(bucket_path);
                const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, account_name);
                const account_options = {
                    gid: account.nsfs_account_config.gid,
                    uid: account.nsfs_account_config.uid,
                    user: account.nsfs_account_config.distinguished_name,
                    new_buckets_path: account.nsfs_account_config.mew_buckets_path,
                };
                await set_path_permissions_and_owner(bucket_path, account_options, 0o700);
                await exec_manage_cli(type, action, { ...bucket_options, bucket_policy: invalid_bucket_policy });
                assert.fail('should have failed with invalid bucket policy');
            } catch (err) {
                assert_error(err, ManageCLIError.MalformedPolicy);
            }
        });

        mocha.it('cli bucket create - bucket_with_policy', async function() {
            const action = ACTIONS.ADD;
            await exec_manage_cli(type, action, bucket_with_policy_options);
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_with_policy);
            assert_bucket(bucket, bucket_with_policy_options, account_id);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_with_policy);
        });

        mocha.it('cli bucket create', async function() {
            const action = ACTIONS.ADD;
            add_res = await exec_manage_cli(type, action, bucket_options);
            assert_response(action, type, add_res, bucket_options, undefined, undefined, account_id);
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, name);
            assert_bucket(bucket, bucket_options, account_id);
            assert(!_.isUndefined(bucket._id));
            // make sure that the config file includes id and owner_account (account id)
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, account_name);
            assert(bucket.owner_account === account._id);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.BUCKETS, name);
        });

        mocha.it('cli bucket create - should fail invalid option', async function() {
            const action = ACTIONS.ADD;
            const bucket_options_with_invalid_option = {...bucket_options, lala: 'lala'}; // lala invalid option
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgument);
            }
        });

        mocha.it('cli bucket status', async function() {
            const action = ACTIONS.STATUS;
            const bucket_status = await exec_manage_cli(type, action, { config_root, name });
            assert_response(action, type, bucket_status, bucket_options, undefined, undefined, account_id);
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, name);
            assert_bucket(bucket, bucket_options, account_id);
        });

        mocha.it('cli bucket status - should fail invalid option', async function() {
            const action = ACTIONS.STATUS;
            const bucket_options_with_invalid_option = {...bucket_options, lala: 'lala'}; // lala invalid option
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgument);
            }
        });

        mocha.it('cli bucket status - bucket does not exist - should fail', async function() {
            const action = ACTIONS.STATUS;
            try {
                await exec_manage_cli(type, action, { config_root, name: 'invalid_bucket' });
                assert.fail('should have failed with bucket does not exist');
            } catch (err) {
                assert_error(err, ManageCLIError.NoSuchBucket);
            }
        });

        mocha.it('cli bucket list', async function() {
            const action = ACTIONS.LIST;
            const bucket_list = await exec_manage_cli(type, action, { config_root });
            const expected_list = [{ name }, { name: bucket_with_policy }];
            assert_response(action, type, bucket_list, expected_list);
        });

        mocha.it('cli bucket list - wide', async function() {
            const action = ACTIONS.LIST;
            const bucket_list = await exec_manage_cli(type, action, { config_root, wide: true });
            const expected_list = [bucket_options, bucket_with_policy_options];
            assert_response(action, type, bucket_list, expected_list, undefined, true, account_id);
        });

        mocha.it('cli bucket list - wide "true"', async function() {
            const action = ACTIONS.LIST;
            const bucket_list = await exec_manage_cli(type, action, { config_root, wide: 'true' });
            const expected_list = [bucket_options, bucket_with_policy_options];
            assert_response(action, type, bucket_list, expected_list, undefined, true, account_id);
        });

        mocha.it('cli bucket list - wide "TRUE" (case insensitive)', async function() {
            const action = ACTIONS.LIST;
            const bucket_list = await exec_manage_cli(type, action, { config_root, wide: 'TRUE' });
            const expected_list = [bucket_options, bucket_with_policy_options];
            assert_response(action, type, bucket_list, expected_list, undefined, true, account_id);
        });

        mocha.it('cli bucket list - wide "false"', async function() {
            const action = ACTIONS.LIST;
            const bucket_list = await exec_manage_cli(type, action, { config_root, wide: 'false' });
            const expected_list = [{ name }, { name: bucket_with_policy }];
            assert_response(action, type, bucket_list, expected_list);
        });

        mocha.it('cli bucket list - wide "FALSE" (case insensitive)', async function() {
            const action = ACTIONS.LIST;
            const bucket_list = await exec_manage_cli(type, action, { config_root, wide: 'FALSE' });
            const expected_list = [{ name }, { name: bucket_with_policy }];
            assert_response(action, type, bucket_list, expected_list, undefined, undefined, account_id);
        });

        mocha.it('cli bucket list - should fail invalid option', async function() {
            const action = ACTIONS.LIST;
            const bucket_options_with_invalid_option = {config_root, lala: 'lala'}; // lala invalid option
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgument);
            }
        });

        mocha.it('cli bucket list wide - should fail invalid string value', async function() {
            const action = ACTIONS.LIST;
            const invalid_wide = 'not-boolean'; // we accept true and false strings
            const bucket_options_with_invalid_option = {config_root, wide: invalid_wide};
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid boolean value');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidBooleanValue);
            }
        });

        mocha.it('cli bucket list wide - should fail invalid type', async function() {
            const action = ACTIONS.LIST;
            const invalid_wide = 1234;
            const bucket_options_with_invalid_option = {config_root, wide: invalid_wide};
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option type');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgumentType);
            }
        });

        mocha.it('cli bucket create - should fail on already exists', async function() {
            const action = ACTIONS.ADD;
            try {
                await exec_manage_cli(type, action, bucket_options);
                assert.fail('should have failed with bucket already exists');
            } catch (err) {
                assert_error(err, ManageCLIError.BucketAlreadyExists);
            }
        });

        mocha.it('cli bucket create - should fail on invalid bucket name', async function() {
            const action = ACTIONS.ADD;
            try {
                await exec_manage_cli(type, action, { ...bucket_options, name: '!123bucket' });
                assert.fail('should have failed with invalid bucket name');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidBucketName);
            }
        });

        mocha.it('cli bucket update - should fail on invalid bucket name', async function() {
            const action = ACTIONS.UPDATE;
            try {
                await exec_manage_cli(type, action, { ...bucket_options, new_name: '!123bucket' });
                assert.fail('should have failed with invalid bucket name');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidBucketName);
            }
        });

        mocha.it('cli bucket update - should fail invalid option', async function() {
            const action = ACTIONS.UPDATE;
            const bucket_options_with_invalid_option = { config_root, name, lala: 'lala'}; // lala invalid option
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgument);
            }
        });

        mocha.it('cli bucket update owner', async function() {
            const action = ACTIONS.UPDATE;
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, account_name2);
            const account_options = {
                gid: account.nsfs_account_config.gid,
                uid: account.nsfs_account_config.uid,
                user: account.nsfs_account_config.distinguished_name,
                new_buckets_path: account.nsfs_account_config.mew_buckets_path,
            };
            await set_path_permissions_and_owner(bucket_path, account_options, 0o700);
            const update_options = { config_root, name, owner: account_name2};
            const update_res = await exec_manage_cli(type, action, update_options);
            bucket_options = { ...bucket_options, ...update_options };
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, name);
            assert_bucket(bucket, bucket_options, account_id2);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.BUCKETS, name);
            assert.equal(JSON.parse(update_res).response.reply.creation_date, JSON.parse(add_res).response.reply.creation_date);
        });

        mocha.it('cli bucket update invalid bucket policy - should fail', async function() {
            const action = ACTIONS.UPDATE;
            const update_options = { config_root, bucket_policy: invalid_bucket_policy, name };
            try {
                await exec_manage_cli(type, action, update_options);
                assert.fail('should have failed with invalid bucket policy');
            } catch (err) {
                assert_error(err, ManageCLIError.MalformedPolicy);
            }
        });

        mocha.it('cli bucket update bucket policy', async function() {
            const action = ACTIONS.UPDATE;
            bucket_options = { ...bucket_options, bucket_policy: bucket1_policy };
            await exec_manage_cli(type, action, bucket_options);
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_options.name);
            assert_bucket(bucket, bucket_options, account_id2);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_options.name);
        });

        mocha.it('cli bucket update bucket policy - delete bucket policy', async function() {
            const action = ACTIONS.UPDATE;
            bucket_options = { ...bucket_options, bucket_policy: empty_bucket_policy };
            await exec_manage_cli(type, action, bucket_options);
            // in the CLI we use empty string to unset the s3_policy
            // but as a parameter is it undefined property
            bucket_options.bucket_policy = undefined;
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_options.name);
            assert_bucket(bucket, bucket_options, account_id2);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_options.name);
        });

        mocha.it('cli bucket update bucket name', async function() {
            const action = ACTIONS.UPDATE;
            const update_options = { config_root, new_name: 'bucket2', name };
            await exec_manage_cli(type, action, update_options);
            bucket_options = { ...bucket_options, ...update_options, new_name: undefined, name: update_options.new_name };
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_options.name);
            assert_bucket(bucket, bucket_options, account_id2);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_options.name);
        });

        mocha.it('cli bucket2 update - new_name already exists', async function() {
            let action = ACTIONS.ADD;
            const bucket_name3 = 'bucket3';
            await exec_manage_cli(type, action, { ...bucket_options, name: bucket_name3 });
            action = ACTIONS.UPDATE;
            try {
                await exec_manage_cli(type, action, { ...bucket_options, name: bucket_name3, new_name: 'bucket2' });
                assert.fail('should have failed with bucket name already exists');
            } catch (err) {
                assert_error(err, ManageCLIError.BucketAlreadyExists);
            }
        });

        mocha.it('cli bucket delete', async function() {
            const action = ACTIONS.DELETE;
            try {
                const res = await exec_manage_cli(type, action, { config_root, name: bucket_options.name });
                assert_response(action, type, res);
                await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, bucket_options.name);
                assert.fail('cli bucket delete failed - bucket config file exists after deletion');
            } catch (err) {
                assert.equal(err.code, 'ENOENT');
            }
        });

        mocha.it('cli bucket delete - should fail invalid option', async function() {
            const action = ACTIONS.UPDATE;
            const bucket_options_with_invalid_option = { config_root, name, lala: 'lala'}; // lala invalid option
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgument);
            }
        });

        mocha.it('cli bucket create on GPFS', async function() {
            const action = ACTIONS.ADD;
            await fs_utils.create_fresh_path(bucket_on_gpfs_path);
            await fs_utils.file_must_exist(bucket_on_gpfs_path);
            await set_path_permissions_and_owner(bucket_on_gpfs_path, account_options1, 0o700);
            const bucket_status = await exec_manage_cli(type, action, gpfs_bucket_options);
            assert_response(action, type, bucket_status, gpfs_bucket_options, undefined, undefined, account_id);
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, gpfs_bucket_options.name);
            assert_bucket(bucket, gpfs_bucket_options, account_id);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.BUCKETS, gpfs_bucket_options.name);
        });

        mocha.it('cli bucket update owner on GPFS', async function() {
            const action = ACTIONS.UPDATE;
            await fs_utils.create_fresh_path(bucket_on_gpfs_path);
            await fs_utils.file_must_exist(bucket_on_gpfs_path);
            gpfs_bucket_options.owner = account_name2;
            await set_path_permissions_and_owner(bucket_on_gpfs_path, account_options2, 0o700);
            const bucket_status = await exec_manage_cli(type, action, gpfs_bucket_options);
            assert_response(action, type, bucket_status, gpfs_bucket_options, undefined, undefined, account_id2);
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, gpfs_bucket_options.name);
            assert_bucket(bucket, gpfs_bucket_options, account_id2);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.BUCKETS, gpfs_bucket_options.name);
        });

        mocha.it('cli bucket update to non GPFS', async function() {
            const action = ACTIONS.UPDATE;
            gpfs_bucket_options.fs_backend = '';
            const bucket_status = await exec_manage_cli(type, action, gpfs_bucket_options);
            // in the CLI we use empty string to unset the fs_backend
            // but as a parameter is it undefined property
            gpfs_bucket_options.fs_backend = undefined;
            assert_response(action, type, bucket_status, gpfs_bucket_options, undefined, undefined, account_id2);
            const bucket = await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, gpfs_bucket_options.name);
            assert_bucket(bucket, gpfs_bucket_options, account_id2);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.BUCKETS, gpfs_bucket_options.name);
        });

        mocha.it('cli GPFS bucket delete', async function() {
            const action = ACTIONS.DELETE;
            try {
                const res = await exec_manage_cli(type, action, { config_root, name: gpfs_bucket_options.name });
                assert_response(action, type, res);
                await read_config_file(config_root, CONFIG_SUBDIRS.BUCKETS, gpfs_bucket_options.name);
                assert.fail('cli bucket delete failed - bucket config file exists after deletion');
            } catch (err) {
                assert.equal(err.code, 'ENOENT');
            }
        });

    });

    mocha.describe('cli invalid actions and types', async function() {

        mocha.it('cli account invalid_action', async function() {
            const type = TYPES.ACCOUNT;
            const action = 'invalid_action';
            try {
                await exec_manage_cli(type, action, { config_root });
                assert.fail('should have failed with invalid action');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidAction);
            }
        });

        mocha.it('cli bucket invalid_action', async function() {
            const type = TYPES.BUCKET;
            const action = 'invalid_action';
            try {
                await exec_manage_cli(type, action, { config_root });
                assert.fail('should have failed with invalid action');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidAction);
            }
        });

        mocha.it('cli invalid_type', async function() {
            const type = 'invalid_type';
            const action = ACTIONS.ADD;
            try {
                await exec_manage_cli(type, action, { config_root });
                assert.fail('should have failed with invalid type');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidType);
            }
        });

    });

    mocha.describe('cli account flow', async function() {
        const type = TYPES.ACCOUNT;
        const name = 'account1';
        const gpfs_account = 'gpfs_account';
        const new_buckets_path = `${root_path}new_buckets_path_user1/`;
        const uid = 999;
        const gid = 999;
        const access_key = 'GIGiFAnjaaE7OKD5N7hA';
        const secret_key = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsDy3o+4h0oFR';
        let account_options = { config_root, name, new_buckets_path, uid, gid, access_key, secret_key };
        const gpfs_account_options = { ...account_options, name: gpfs_account, fs_backend: 'GPFS' };
        let updating_options = account_options;
        let compare_details; // we will use it for update account and compare the results
        let add_res;

        mocha.it('cli account create', async function() {
            const action = ACTIONS.ADD;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, { uid, gid }, 0o700);
            add_res = await exec_manage_cli(type, action, account_options);
            assert_response(action, type, add_res, account_options);
            const account_symlink = await read_config_file(config_root, CONFIG_SUBDIRS.ACCESS_KEYS, access_key);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, name);
            assert_account(account, account_options);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, name);
        });

        mocha.it('cli account status', async function() {
            const action = ACTIONS.STATUS;
            const account_status = await exec_manage_cli(type, action, { config_root, name: account_options.name });
            assert_response(action, type, account_status, account_options);
            const access_key_account_status = await exec_manage_cli(type, action, { config_root, access_key: account_options.access_key });
            assert_response(action, type, access_key_account_status, account_options);
            const account_symlink = await read_config_file(config_root, CONFIG_SUBDIRS.ACCESS_KEYS, access_key);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, name);
            assert_account(account, account_options);
        });

        mocha.it('cli account status - account does not exist - should fail', async function() {
            const action = ACTIONS.STATUS;
            try {
                await exec_manage_cli(type, action, { config_root, name: 'invalid_account' });
                assert.fail('should have failed with account does not exist');
            } catch (err) {
                assert_error(err, ManageCLIError.NoSuchAccountName);
            }
        });

        mocha.it('cli account status show_secrets', async function() {
            const action = ACTIONS.STATUS;
            const account_status = await exec_manage_cli(type, action, { config_root, name: account_options.name, show_secrets: true });
            assert_response(action, type, account_status, account_options, true);
            const account_symlink = await read_config_file(config_root, CONFIG_SUBDIRS.ACCESS_KEYS, access_key);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, name);
            assert_account(account, account_options);
        });

        mocha.it('cli account status show_secrets "true"', async function() {
            const action = ACTIONS.STATUS;
            const account_status = await exec_manage_cli(type, action, { config_root, name: account_options.name, show_secrets: 'true' });
            assert_response(action, type, account_status, account_options, true);
            const account_symlink = await read_config_file(config_root, CONFIG_SUBDIRS.ACCESS_KEYS, access_key);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, name);
            assert_account(account, account_options);
        });

        mocha.it('cli account status show_secrets "TRUE" (case insensitive)', async function() {
            const action = ACTIONS.STATUS;
            const account_status = await exec_manage_cli(type, action, { config_root, name: account_options.name, show_secrets: 'TRUE' });
            assert_response(action, type, account_status, account_options, true);
            const account_symlink = await read_config_file(config_root, CONFIG_SUBDIRS.ACCESS_KEYS, access_key);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, name);
            assert_account(account, account_options);
        });

        mocha.it('cli account status show_secrets "false"', async function() {
            const action = ACTIONS.STATUS;
            const account_status = await exec_manage_cli(type, action, { config_root, name: account_options.name, show_secrets: 'false' });
            // when there is no show_secrets, the access_keys property doesn't exists in the reply
            assert.equal(JSON.parse(account_status).response.reply.access_keys, undefined);
        });

        mocha.it('cli account status show_secrets "FALSE" (case insensitive)', async function() {
            const action = ACTIONS.STATUS;
            const account_status = await exec_manage_cli(type, action, { config_root, name: account_options.name, show_secrets: 'FALSE' });
            // when there is no show_secrets, the access_keys property doesn't exists in the reply
            assert.equal(JSON.parse(account_status).response.reply.access_keys, undefined);
        });

        mocha.it('list wide with invalid string value - should fail', async function() {
            const action = ACTIONS.STATUS;
            try {
                await exec_manage_cli(type, action, { config_root, name: account_options.name, show_secrets: 'blabla' });
                assert.fail('should have failed with invalid boolean value');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidBooleanValue);
            }
        });

        mocha.it('list wide with invalid type - should fail', async function() {
            const action = ACTIONS.STATUS;
            try {
                await exec_manage_cli(type, action, { config_root, name: account_options.name, show_secrets: 1234 });
                assert.fail('should have failed with invalid option type');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgumentType);
            }
        });

        mocha.it('cli account create - no uid gid - should fail', async function() {
            const action = ACTIONS.ADD;
            try {
                await exec_manage_cli(type, action, { config_root, name: account_options.name, access_key, secret_key });
                assert.fail('should have failed with account config should not be empty');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidAccountNSFSConfig);
            }
        });

        mocha.it('cli account create - no uid - should fail', async function() {
            const action = ACTIONS.ADD;
            try {
                await exec_manage_cli(type, action, { config_root, name: account_options.name, access_key, secret_key, gid: 1001});
                assert.fail('should have failed with account config should include UID');
            } catch (err) {
                assert_error(err, ManageCLIError.MissingAccountNSFSConfigUID);
            }
        });

        mocha.it('cli account create - no gid - should fail', async function() {
            const action = ACTIONS.ADD;
            try {
                await exec_manage_cli(type, action, { config_root, name: account_options.name, access_key, secret_key, uid: 1001});
                assert.fail('should have failed with account config should include GID');
            } catch (err) {
                assert_error(err, ManageCLIError.MissingAccountNSFSConfigGID);
            }
        });

        mocha.it('cli account create - new_buckets_path does not exist - should fail', async function() {
            const action = ACTIONS.ADD;
            try {
                await exec_manage_cli(type, action, { ...account_options, new_buckets_path: 'path_does/not_exist' });
                assert.fail('should have failed with new_buckets_path should be a valid dir path');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidAccountNewBucketsPath);
            }
        });

        mocha.it('cli account create - name exists - should fail', async function() {
            const action = ACTIONS.ADD;
            try {
                await exec_manage_cli(type, action, { ...account_options, access_key: 'GIGiFAnjaaE7OKrandom' });
                assert.fail('should have failed with account name already exists');
            } catch (err) {
                assert_error(err, ManageCLIError.AccountNameAlreadyExists);
            }
        });

        mocha.it('cli account create - access_key exists - should fail', async function() {
            const action = ACTIONS.ADD;
            try {
                await exec_manage_cli(type, action, { ...account_options, name: 'random' });
                assert.fail('should have failed with account access key already exists');
            } catch (err) {
                assert_error(err, ManageCLIError.AccountAccessKeyAlreadyExists);
            }
        });

        mocha.it('cli account list', async function() {
            const action = ACTIONS.LIST;
            const account_list = await exec_manage_cli(type, action, { config_root });
            const expected_list = [{ name }];
            assert_response(action, type, account_list, expected_list);
        });

        mocha.it('cli account list - wide', async function() {
            const action = ACTIONS.LIST;
            const account_list = await exec_manage_cli(type, action, { config_root, wide: true });
            const expected_list = [account_options];
            assert_response(action, type, account_list, expected_list, undefined, true);
        });

        mocha.it('cli account update uid by name', async function() {
            const action = ACTIONS.UPDATE;
            const update_options = {
                config_root,
                name,
                uid: 222,
                gid: 222,
                new_buckets_path: `${root_path}new_buckets_path_user2/`
            };
            await fs_utils.create_fresh_path(update_options.new_buckets_path);
            await fs_utils.file_must_exist(update_options.new_buckets_path);
            await set_path_permissions_and_owner(update_options.new_buckets_path, update_options, 0o700);
            const update_response = await exec_manage_cli(type, action, update_options);

            updating_options = { ...updating_options, ...update_options };
            assert_response(action, type, update_response, updating_options);
            account_options = { ...account_options, ...update_options };
            const account_symlink = await read_config_file(config_root, CONFIG_SUBDIRS.ACCESS_KEYS, access_key);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, name);
            assert_account(account, account_options);
            assert.equal(JSON.parse(update_response).response.reply.creation_date, JSON.parse(add_res).response.reply.creation_date);
        });

        mocha.it('cli account delete by name', async function() {
            const action = ACTIONS.DELETE;
            const res = await exec_manage_cli(type, action, { config_root, name: account_options.name });
            assert_response(action, type, res);
            try {
                await read_config_file(config_root, CONFIG_SUBDIRS.ACCESS_KEYS, account_options.access_key);
                throw new Error('cli account delete failed - account config link file exists after deletion');
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw new Error('cli account delete failed - read file failed with the following error - ', err.code);
                }
            }
            try {
                await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, account_options.name);
                throw new Error('cli account delete failed - account config file exists after deletion');
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw new Error('cli account delete failed - read file failed with the following error - ', err.code);
                }
            }
        });

        mocha.it('cli account create on GPFS', async function() {
            const action = ACTIONS.ADD;
            const account_status = await exec_manage_cli(type, action, gpfs_account_options);
            assert_response(action, type, account_status, gpfs_account_options);
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, gpfs_account_options.name);
            assert_account(account, gpfs_account_options);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, gpfs_account_options.name);
        });

        mocha.it('cli account update to non GPFS', async function() {
            const action = ACTIONS.UPDATE;
            const account_options_for_update_fs_backend = {
                config_root: gpfs_account_options.config_root, // needed for exec_manage_cli function
                name: gpfs_account_options.name,
                fs_backend: '', // remove the 'GPFS'
            };
            const account_status = await exec_manage_cli(type, action, account_options_for_update_fs_backend);
            compare_details = {
                ...gpfs_account_options,
                ...account_options_for_update_fs_backend,
            };
            // in the CLI we use empty string to unset the fs_backend
            // but as a parameter is it undefined property
            compare_details.fs_backend = undefined;
            assert_response(action, type, account_status, compare_details);
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, gpfs_account_options.name,);
            assert_account(account, compare_details);
            await assert_config_file_permissions(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, gpfs_account_options.name);
        });

        mocha.it('cli account delete', async function() {
            const action = ACTIONS.DELETE;
            try {
                const res = await exec_manage_cli(type, action, { config_root, name: gpfs_account_options.name });
                assert_response(action, type, res);
                await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, gpfs_account_options.name);
                assert.fail('cli account delete failed - account config file exists after deletion');
            } catch (err) {
                assert.equal(err.code, 'ENOENT');
            }
        });
    });

    mocha.describe('cli account flow - updates', async function() {
        this.timeout(50000); // eslint-disable-line no-invalid-this
        const type = TYPES.ACCOUNT;
        const name1 = 'account1';
        const name2 = 'account2';
        const new_buckets_path = `${root_path}new_buckets_path_user1/`;
        const uid = 999;
        const gid = 999;
        const access_key = 'GIGiFAnjaaE7OKD5N7hA';
        const secret_key = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsDy3o+4h0oFR';
        const account1_options = { config_root, name: name1, new_buckets_path, uid, gid, access_key, secret_key };
        const account1_options_for_delete = { config_root, name: name1 };
        const account2_options = { config_root, name: 'account2', new_buckets_path, uid, gid, access_key: 'BISiDSnjaaE7OKD5N7hB', secret_key };
        const account2_options_for_delete = { config_root, name: name2 };
        mocha.before(async () => {
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, { uid, gid }, 0o700);
            const action = ACTIONS.ADD;
            await exec_manage_cli(type, action, account1_options);
            await exec_manage_cli(type, action, account2_options);
        });
        mocha.after(async () => {
            await fs_utils.folder_delete(new_buckets_path);
            const action = ACTIONS.DELETE;
            await exec_manage_cli(type, action, account1_options_for_delete);
            await exec_manage_cli(type, action, account2_options_for_delete);
        });

        mocha.it('cli account2 update - new_name already exists', async function() {
            const action = ACTIONS.UPDATE;
            try {
                await exec_manage_cli(type, action, { ...account2_options, new_name: 'account1' });
                assert.fail('should have failed with account name already exists');
            } catch (err) {
                assert_error(err, ManageCLIError.AccountNameAlreadyExists);
            }
        });

        mocha.it('cli account2 update - new_access_key already exists', async function() {
            const action = ACTIONS.UPDATE;
            const options = { ...account2_options };
            options.access_key = 'GIGiFAnjaaE7OKD5N7hA';
            try {
                await exec_manage_cli(type, action, options);
                assert.fail('should have failed with account access key already exists');
            } catch (err) {
                assert_error(err, ManageCLIError.AccountAccessKeyAlreadyExists);
            }
        });
    });

    mocha.describe('cli account flow distinguished_name - happy path', async function() {
        this.timeout(50000); // eslint-disable-line no-invalid-this
        const type = TYPES.ACCOUNT;
        const name = 'account2';
        const new_buckets_path = `${root_path}new_buckets_path_user2/`;
        const new_buckets_path_new_dn = `${root_path}new_buckets_path_new_dn/`;
        const distinguished_name = 'root';
        const access_key = 'GIGiFAnjaaE7OKD5N7hB';
        const secret_key = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsDy3o+4h0oFr';
        let account_options = { config_root, name, new_buckets_path, distinguished_name, access_key, secret_key };
        const new_user = 'newuser';

        mocha.before(async () => {
            this.timeout(50000); // eslint-disable-line no-invalid-this
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await fs_utils.create_fresh_path(new_buckets_path_new_dn);
            await fs_utils.file_must_exist(new_buckets_path_new_dn);
            await create_fs_user_by_platform(new_user, 'newpass', 2222, 2222);
            await set_path_permissions_and_owner(new_buckets_path_new_dn, { uid: 2222, gid: 2222 }, 0o700);
        });

        mocha.after(async () => {
            this.timeout(50000); // eslint-disable-line no-invalid-this
            await delete_fs_user_by_platform(new_user);
        });

        mocha.it('cli account create', async function() {
            const action = ACTIONS.ADD;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            const res = await exec_manage_cli(type, action, account_options);
            assert_response(action, type, res, account_options);
            const account_symlink = await read_config_file(config_root, CONFIG_SUBDIRS.ACCESS_KEYS, access_key);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, name);
            assert_account(account, account_options);
        });

        mocha.it('cli account update distinguished_name', async function() {
            const action = ACTIONS.UPDATE;
            const update_options = {
                config_root,
                name,
                new_buckets_path: new_buckets_path_new_dn,
                distinguished_name: new_user,
            };
            const res = await exec_manage_cli(type, action, update_options);
            account_options = { ...account_options, ...update_options };
            assert_response(action, type, res, account_options);
            const account_symlink = await read_config_file(config_root, CONFIG_SUBDIRS.ACCESS_KEYS, access_key);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, name);
            assert_account(account, account_options);
        });

        mocha.it('cli account delete by name', async function() {
            const action = ACTIONS.DELETE;
            const res = await exec_manage_cli(type, action, { config_root, name: account_options.name });
            assert_response(action, type, res);
            try {
                await read_config_file(config_root, CONFIG_SUBDIRS.ACCESS_KEYS, access_key);
                throw new Error('cli account delete failed - account config file exists after deletion');
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw new Error('cli account delete failed - read file failed with the following error - ', err.code);
                }
            }
            try {
                await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, account_options.name);
                throw new Error('cli account delete failed - account config file exists after deletion');
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw new Error('cli account delete failed - read file failed with the following error - ', err.code);
                }
            }
        });
    });

    mocha.describe('cli whitelist flow', async function() {
        this.timeout(50000); // eslint-disable-line no-invalid-this
        const type = TYPES.IP_WHITELIST;
        const config_options = { ENDPOINT_FORKS: 1, UV_THREADPOOL_SIZE: 4 };
        mocha.before(async () => {
            await write_config_file(config_root, '', 'config', config_options);
        });
        mocha.after(async () => {
            await fs_utils.file_delete(path.join(config_root, 'config.json'));
        });

        mocha.it('cli add whitelist ips first time (IPV4 format)', async function() {
            const ips = ['127.0.0.1']; // IPV4 format
            const res = await exec_manage_cli(type, '', { config_root, ips: JSON.stringify(ips) });
            config_options.S3_SERVER_IP_WHITELIST = ips;
            const config_data = await read_config_file(config_root, '', 'config');
            assert_response('', type, res, ips);
            assert_whitelist(config_data, config_options);
        });

        mocha.it('cli update whitelist ips (IPV6 expanded format)', async function() {
            const ips = ['0000:0000:0000:0000:0000:ffff:7f00:0002']; // IPV6 expanded format
            const res = await exec_manage_cli(type, '', { config_root, ips: JSON.stringify(ips) });
            config_options.S3_SERVER_IP_WHITELIST = ips;
            const config_data = await read_config_file(config_root, '', 'config');
            assert_response('', type, res, ips);
            assert_whitelist(config_data, config_options);
        });

        mocha.it('cli update whitelist ips (IPV6 compressed format)', async function() {
            const ips = ['::ffff:7f00:3']; // IPV6 compressed format
            const res = await exec_manage_cli(type, '', { config_root, ips: JSON.stringify(ips) });
            config_options.S3_SERVER_IP_WHITELIST = ips;
            const config_data = await read_config_file(config_root, '', 'config');
            assert_response('', type, res, ips);
            assert_whitelist(config_data, config_options);
        });

        mocha.it('cli whitelist ips is empty', async function() {
            try {
                await exec_manage_cli(type, '', { config_root, ips: '' });
                assert.fail('should have failed with whitelist ips should not be empty.');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidWhiteListIPFormat);
            }
        });

        mocha.it('cli whitelist formate is invalid', async function() {
            try {
                const ips = ['127.0.0.1'];
                const ip_list_invalid_format = JSON.stringify(ips) + 'invalid';
                await exec_manage_cli(type, '', { config_root, ips: ip_list_invalid_format });
                assert.fail('should have failed with whitelist ips with invalid body format');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidWhiteListIPFormat);
            }
        });

        mocha.it('cli whitelist has invalid IP address (one item in the list)', async function() {
            const ip_list_with_invalid_ip_address = ['10.1.11']; // missing a class in the IP address
            try {
                await exec_manage_cli(type, '', { config_root, ips: ip_list_with_invalid_ip_address});
                assert.fail('should have failed with whitelist ips with invalid ip address');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidWhiteListIPFormat);
            }
        });

        mocha.it('cli whitelist has invalid IP address (a couple of items in the list)', async function() {
            const invalid_ip_address = '10.1.11'; // missing a class in the IP address
            const ips = ['127.0.0.1', '::ffff:7f00:3', '0000:0000:0000:0000:0000:ffff:7f00:0002'];
            ips.push(invalid_ip_address);
            try {
                await exec_manage_cli(type, '', { config_root, ips: ips});
                assert.fail('should have failed with whitelist ips with invalid ip address');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidWhiteListIPFormat);
            }
        });

        mocha.it('cli whitelist with invalid option', async function() {
            const ips = ['127.0.0.1']; // IPV4 format
            try {
                await exec_manage_cli(type, '', {
                    config_root,
                    ips: JSON.stringify(ips),
                    lala: 'lala', // lala invalid option
                });
                assert.fail('should have failed with invalid option');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgument);
            }
        });
    });

});

function get_config_path(config_root, schema_dir, config_file_name) {
    if (schema_dir === CONFIG_SUBDIRS.ROOT_ACCOUNTS) {
        return path.join(config_root, schema_dir, config_file_name, config_file_name + '.symlink');
    } else if (schema_dir === CONFIG_SUBDIRS.ACCESS_KEYS) {
        return path.join(config_root, schema_dir, config_file_name + '.symlink');
    } else {
        return path.join(config_root, schema_dir, config_file_name + '.json');
    }
}

async function read_config_file(config_root, schema_dir, config_file_name) {
    const config_path = get_config_path(config_root, schema_dir, config_file_name);
    const { data } = await nb_native().fs.readFile(DEFAULT_FS_CONFIG, config_path);
    const config_data = JSON.parse(data.toString());
    if (config_data.access_keys) {
        const encrypted_secret_key = config_data.access_keys[0].encrypted_secret_key;
        config_data.access_keys[0].secret_key = await nc_mkm.decrypt(encrypted_secret_key, config_data.master_key_id);
        delete config_data.access_keys[0].encrypted_secret_key;
    }
    return config_data;
}

async function write_config_file(config_root, schema_dir, config_file_name, data) {
    const config_path = get_config_path(config_root, schema_dir, config_file_name);
    await nb_native().fs.writeFile(DEFAULT_FS_CONFIG, config_path,
        Buffer.from(JSON.stringify(data)), {
            mode: config_module.BASE_MODE_FILE,
        });
}

async function assert_config_file_permissions(config_root, schema_dir, config_file_name) {
    const config_path = get_config_path(config_root, schema_dir, config_file_name);
    const { stat } = await nb_native().fs.readFile(DEFAULT_FS_CONFIG, config_path);
    // 33152 means 600 (only owner has read and write permissions)
    assert.equal(stat.mode, 33152);
}

function assert_error(err, expect_error) {
    const parsed_err = JSON.parse(err.stdout);
    assert.equal(parsed_err.error.code, expect_error.code);
}

function assert_response(action, type, actual_res, expected_res, show_secrets, wide, account_id) {
    const parsed = JSON.parse(actual_res);
    if (type === TYPES.IP_WHITELIST) {
        assert.equal(parsed.response.code, ManageCLIResponse.WhiteListIPUpdated.code);
        assert.deepStrictEqual(parsed.response.reply, expected_res);
    } else if (type === TYPES.BUCKET) {
        if (action === ACTIONS.STATUS ||
            action === ACTIONS.ADD ||
            action === ACTIONS.UPDATE) {
            assert_bucket(parsed.response.reply, expected_res, account_id);
        } else if (action === ACTIONS.DELETE) {
            assert.equal(parsed.response.code, ManageCLIResponse.BucketDeleted.code);
        } else if (action === ACTIONS.LIST) {
            assert.equal(parsed.response.reply.length, expected_res.length);
            for (let i = 0; i < parsed.response.reply.length; i++) {
                const name = parsed.response.reply[i].name;
                const expected_res_by_name = expected_res.find(expected => expected.name === name);
                if (wide) {
                    assert_bucket(parsed.response.reply[i], expected_res_by_name, account_id);
                } else {
                    assert.deepEqual(parsed.response.reply[i], expected_res_by_name);

                }
            }
        } else {
            assert.fail(`Invalid command action - ${action}`);
        }
    } else if (type === TYPES.ACCOUNT) {
        if (action === ACTIONS.STATUS ||
            action === ACTIONS.ADD ||
            action === ACTIONS.UPDATE) {
            assert_account(parsed.response.reply, expected_res, !show_secrets);
        } else if (action === ACTIONS.DELETE) {
            assert.equal(parsed.response.code, ManageCLIResponse.AccountDeleted.code);
        } else if (action === ACTIONS.LIST) {
            if (wide) {
                for (let i = 0; i < parsed.response.reply.length; i++) {
                    assert_account(parsed.response.reply[i], expected_res[i], !show_secrets);
                }
            } else {
                assert.deepEqual(parsed.response.reply, expected_res);
            }
        } else {
            assert.fail(`Invalid command action - ${action}`);
        }
    } else {
        assert.fail(`Invalid command type - ${type}`);
    }
}

function assert_bucket(bucket, bucket_options, account_id) {
    assert.strictEqual(bucket.name, bucket_options.name);
    assert.strictEqual(bucket.system_owner, account_id);
    //depending on whether we got bucket through manage_nsfs cli or by reading the file,
    //bucket will either have owner_account object or owner_account field
    assert.strictEqual(bucket.owner_account.id || bucket.owner_account, account_id);
    assert.strictEqual(bucket.path, bucket_options.path);
    assert.strictEqual(bucket.should_create_underlying_storage, false);
    assert.strictEqual(bucket.versioning, 'DISABLED');
    assert.strictEqual(bucket.fs_backend, bucket_options.fs_backend === '' ? undefined : bucket_options.fs_backend);
    assert.deepStrictEqual(bucket.s3_policy, bucket_options.bucket_policy);
    return true;
}

function assert_account(account, account_options, skip_secrets) {
    if (!skip_secrets) {
        assert.deepStrictEqual(account.access_keys[0].access_key, account_options.access_key);
        assert.deepStrictEqual(account.access_keys[0].secret_key, account_options.secret_key);
    }
    assert.equal(account.name, account_options.name);
    if (account_options.distinguished_name) {
        assert.equal(account.nsfs_account_config.distinguished_name, account_options.distinguished_name);
        assert.equal(account.nsfs_account_config.uid, undefined);
        assert.equal(account.nsfs_account_config.gid, undefined);
    } else {
        assert.equal(account.nsfs_account_config.uid, account_options.uid);
        assert.equal(account.nsfs_account_config.gid, account_options.gid);
        assert.equal(account.nsfs_account_config.distinguished_name, undefined);

    }
    assert.equal(account.nsfs_account_config.new_buckets_path, account_options.new_buckets_path);
    assert.equal(account.nsfs_account_config.fs_backend, account_options.fs_backend === '' ? undefined : account_options.fs_backend);
    return true;
}

function assert_whitelist(config_data, config_options) {
    assert.strictEqual(config_data.ENDPOINT_FORKS, config_options.ENDPOINT_FORKS);
    assert.strictEqual(config_data.UV_THREADPOOL_SIZE, config_options.UV_THREADPOOL_SIZE);
    assert.strictEqual(config_data.S3_SERVER_IP_WHITELIST.length, config_options.S3_SERVER_IP_WHITELIST.length);
    return true;
}
