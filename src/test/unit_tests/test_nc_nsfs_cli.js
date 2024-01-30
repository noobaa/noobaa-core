/* Copyright (C) 2016 NooBaa */
'use strict';
/* eslint-disable max-lines-per-function */

const _ = require('lodash');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const P = require('../../util/promise');
const fs_utils = require('../../util/fs_utils');
const nb_native = require('../../util/nb_native');
const config_module = require('../../../config');
const { ManageCLIError } = require('../../manage_nsfs/manage_nsfs_cli_errors');
const { ManageCLIResponse } = require('../../manage_nsfs/manage_nsfs_cli_responses');
const { exec_manage_cli, generate_s3_policy, nc_nsfs_manage_actions, nc_nsfs_manage_entity_types } = require('../system_tests/test_utils');

const MAC_PLATFORM = 'darwin';
let tmp_fs_path = '/tmp/test_bucketspace_fs';
if (process.platform === MAC_PLATFORM) {
    tmp_fs_path = '/private/' + tmp_fs_path;
}
const DEFAULT_FS_CONFIG = {
    uid: process.getuid(),
    gid: process.getgid(),
    backend: '',
    warn_threshold_ms: 100,
};

mocha.describe('manage_nsfs cli', function() {

    const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
    const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
    const buckets = 'buckets';
    const accounts = 'accounts';
    const access_keys = 'access_keys';

    mocha.before(async () => {
        await P.all(_.map([accounts, buckets, access_keys], async dir =>
            fs_utils.create_fresh_path(`${config_root}/${dir}`)));
        await fs_utils.create_fresh_path(root_path);
    });
    mocha.after(async () => {
        fs_utils.folder_delete(`${config_root}`);
        fs_utils.folder_delete(`${root_path}`);
    });

    mocha.describe('cli bucket flow ', async function() {
        const type = nc_nsfs_manage_entity_types.BUCKET;
        const account_name = 'user1';
        const name = 'bucket1';
        const bucket_on_gpfs = 'bucketgpfs1';
        const email = 'user1@noobaa.io';
        const bucket_path = `${root_path}${name}/`;
        const bucket_with_policy = 'bucket-with-policy';
        const bucket_policy = generate_s3_policy('*', bucket_with_policy, ['s3:*']).policy;
        const bucket1_policy = generate_s3_policy('*', name, ['s3:*']).policy;
        const invalid_bucket_policy = generate_s3_policy('invalid_account', name, ['s3:*']).policy;
        const empty_bucket_policy = '';
        let add_res;

        const schema_dir = 'buckets';
        const schema_dir_accounts = 'accounts';
        let bucket_options = { config_root, name, email, path: bucket_path };
        const gpfs_bucket_options = { config_root, name: bucket_on_gpfs, email, path: bucket_path, fs_backend: 'GPFS' };
        const bucket_with_policy_options = { ...bucket_options, bucket_policy: bucket_policy, name: bucket_with_policy };

        mocha.before(async () => {
            await P.all(_.map([accounts, buckets, access_keys], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
            await fs_utils.create_fresh_path(root_path);
        });
        mocha.after(async () => {
            fs_utils.folder_delete(`${config_root}`);
            fs_utils.folder_delete(`${root_path}`);
        });

        mocha.it('cli bucket create without existing account - should fail', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            try {
                await fs_utils.create_fresh_path(bucket_path);
                await fs_utils.file_must_exist(bucket_path);
                await exec_manage_cli(type, action, bucket_options);
                assert.fail('should have failed since the bucket owner does not exist');
            } catch (err) {
                assert_error(err, ManageCLIError.BucketSetForbiddenNoBucketOwner);
            }
        });

        mocha.it('cli create account for bucket (bucket create requirement to have a bucket owner)', async function() {
            const account_name2 = 'user2';
            const owner_email = email;
            const owner_email2 = 'user2@noobaa.io';
            const new_buckets_path1 = `${root_path}new_buckets_path_user1111/`;
            const new_buckets_path2 = `${root_path}new_buckets_path_user2222/`;
            const uid1 = 1111;
            const uid2 = 2222;
            const gid1 = 1111;
            const gid2 = 2222;

            const action = nc_nsfs_manage_actions.ADD;
            // create account 'user1' 'user1@noobaa.io'
            const account_options1 = {
                config_root: config_root,
                name: account_name,
                email: owner_email,
                new_buckets_path: new_buckets_path1,
                uid: uid1,
                gid: gid1,
            };
            await fs_utils.create_fresh_path(new_buckets_path1);
            await fs_utils.file_must_exist(new_buckets_path1);
            await exec_manage_cli(nc_nsfs_manage_entity_types.ACCOUNT, action, account_options1);
            // create account 'user2' 'user2@noobaa.io'
            const account_options2 = {
                config_root: config_root,
                name: account_name2,
                email: owner_email2,
                new_buckets_path: new_buckets_path2,
                uid: uid2,
                gid: gid2,
            };
            await fs_utils.create_fresh_path(new_buckets_path2);
            await fs_utils.file_must_exist(new_buckets_path2);
            await exec_manage_cli(nc_nsfs_manage_entity_types.ACCOUNT, action, account_options2);
        });

        mocha.it('cli bucket create with invalid bucket policy - should fail', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            try {
                await fs_utils.create_fresh_path(bucket_path);
                await fs_utils.file_must_exist(bucket_path);
                await exec_manage_cli(type, action, { ...bucket_options, bucket_policy: invalid_bucket_policy });
                assert.fail('should have failed with invalid bucket policy');
            } catch (err) {
                assert_error(err, ManageCLIError.MalformedPolicy);
            }
        });

        mocha.it('cli bucket create - bucket_with_policy', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            await exec_manage_cli(type, action, bucket_with_policy_options);
            const bucket = await read_config_file(config_root, schema_dir, bucket_with_policy);
            assert_bucket(bucket, bucket_with_policy_options);
            await assert_config_file_permissions(config_root, schema_dir, bucket_with_policy);
        });

        mocha.it('cli bucket create', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            add_res = await exec_manage_cli(type, action, bucket_options);
            assert_response(action, type, add_res, bucket_options);
            const bucket = await read_config_file(config_root, schema_dir, name);
            // make sure that the config file includes id and owner_account (account id)
            assert(!_.isUndefined(bucket._id));
            const account = await read_config_file(config_root, schema_dir_accounts, account_name);
            assert(bucket.owner_account === account._id);
            assert_bucket(bucket, bucket_options);
            await assert_config_file_permissions(config_root, schema_dir, name);
        });

        mocha.it('cli bucket create - should fail invalid option', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            const bucket_options_with_invalid_option = {...bucket_options, lala: 'lala'}; // lala invalid option
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgument);
            }
        });

        mocha.it('cli bucket status', async function() {
            const action = nc_nsfs_manage_actions.STATUS;
            const bucket_status = await exec_manage_cli(type, action, { config_root, name });
            assert_response(action, type, bucket_status, bucket_options);
            const bucket = await read_config_file(config_root, schema_dir, name);
            assert_bucket(bucket, bucket_options);
        });

        mocha.it('cli bucket status - should fail invalid option', async function() {
            const action = nc_nsfs_manage_actions.STATUS;
            const bucket_options_with_invalid_option = {...bucket_options, lala: 'lala'}; // lala invalid option
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgument);
            }
        });

        mocha.it('cli bucket status - bucket does not exist - should fail', async function() {
            const action = nc_nsfs_manage_actions.STATUS;
            try {
                await exec_manage_cli(type, action, { config_root, name: 'invalid_bucket' });
                assert.fail('should have failed with bucket does not exist');
            } catch (err) {
                assert_error(err, ManageCLIError.NoSuchBucket);
            }
        });

        mocha.it('cli bucket list', async function() {
            const action = nc_nsfs_manage_actions.LIST;
            const bucket_list = await exec_manage_cli(type, action, { config_root });
            const expected_list = [{ name }, { name: bucket_with_policy }];
            assert_response(action, type, bucket_list, expected_list);
        });

        mocha.it('cli bucket list - wide', async function() {
            const action = nc_nsfs_manage_actions.LIST;
            const bucket_list = await exec_manage_cli(type, action, { config_root, wide: true });
            const expected_list = [bucket_options, bucket_with_policy_options];
            assert_response(action, type, bucket_list, expected_list, undefined, true);
        });

        mocha.it('cli bucket list - should fail invalid option', async function() {
            const action = nc_nsfs_manage_actions.LIST;
            const bucket_options_with_invalid_option = {config_root, lala: 'lala'}; // lala invalid option
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgument);
            }
        });

        mocha.it('cli bucket list - should fail invalid option type', async function() {
            const action = nc_nsfs_manage_actions.LIST;
            const invalid_wide = 'not-boolean';
            const bucket_options_with_invalid_option = {config_root, wide: invalid_wide};
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option type');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgumentType);
            }
        });

        mocha.it('cli bucket create - should fail on already exists', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            try {
                await exec_manage_cli(type, action, bucket_options);
                assert.fail('should have failed with bucket already exists');
            } catch (err) {
                assert_error(err, ManageCLIError.BucketAlreadyExists);
            }
        });

        mocha.it('cli bucket create - should fail on invalid bucket name', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            try {
                await exec_manage_cli(type, action, { ...bucket_options, name: '!123bucket' });
                assert.fail('should have failed with invalid bucket name');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidBucketName);
            }
        });

        mocha.it('cli bucket update - should fail on invalid bucket name', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            try {
                await exec_manage_cli(type, action, { ...bucket_options, new_name: '!123bucket' });
                assert.fail('should have failed with invalid bucket name');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidBucketName);
            }
        });

        mocha.it('cli bucket update - should fail invalid option', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const bucket_options_with_invalid_option = { config_root, name, lala: 'lala'}; // lala invalid option
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgument);
            }
        });

        mocha.it('cli bucket update owner email', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const update_options = { config_root, email: 'user2@noobaa.io', name };
            const update_res = await exec_manage_cli(type, action, update_options);
            bucket_options = { ...bucket_options, ...update_options };
            const bucket = await read_config_file(config_root, schema_dir, name);
            assert_bucket(bucket, bucket_options);
            await assert_config_file_permissions(config_root, schema_dir, name);
            assert.equal(JSON.parse(update_res).response.reply.creation_date, JSON.parse(add_res).response.reply.creation_date);
        });

        mocha.it('cli bucket update invalid bucket policy - should fail', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const update_options = { config_root, bucket_policy: invalid_bucket_policy, name };
            try {
                await exec_manage_cli(type, action, update_options);
                assert.fail('should have failed with invalid bucket policy');
            } catch (err) {
                assert_error(err, ManageCLIError.MalformedPolicy);
            }
        });

        mocha.it('cli bucket update bucket policy', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            bucket_options = { ...bucket_options, bucket_policy: bucket1_policy };
            await exec_manage_cli(type, action, bucket_options);
            const bucket = await read_config_file(config_root, schema_dir, bucket_options.name);
            assert_bucket(bucket, bucket_options);
            await assert_config_file_permissions(config_root, schema_dir, bucket_options.name);
        });

        mocha.it('cli bucket update bucket policy - delete bucket policy', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            bucket_options = { ...bucket_options, bucket_policy: empty_bucket_policy };
            await exec_manage_cli(type, action, bucket_options);
            // in the CLI we use empty string to unset the s3_policy
            // but as a parameter is it undefined property
            bucket_options.bucket_policy = undefined;
            const bucket = await read_config_file(config_root, schema_dir, bucket_options.name);
            assert_bucket(bucket, bucket_options);
            await assert_config_file_permissions(config_root, schema_dir, bucket_options.name);
        });

        mocha.it('cli bucket update bucket name', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const update_options = { config_root, new_name: 'bucket2', name };
            await exec_manage_cli(type, action, update_options);
            bucket_options = { ...bucket_options, ...update_options, new_name: undefined, name: update_options.new_name };
            const bucket = await read_config_file(config_root, schema_dir, bucket_options.name);
            assert_bucket(bucket, bucket_options);
            await assert_config_file_permissions(config_root, schema_dir, bucket_options.name);
        });

        mocha.it('cli bucket2 update - new_name already exists', async function() {
            let action = nc_nsfs_manage_actions.ADD;
            const bucket_name3 = 'bucket3';
            await exec_manage_cli(type, action, { ...bucket_options, name: bucket_name3 });
            action = nc_nsfs_manage_actions.UPDATE;
            try {
                await exec_manage_cli(type, action, { ...bucket_options, name: bucket_name3, new_name: 'bucket2' });
                assert.fail('should have failed with bucket name already exists');
            } catch (err) {
                assert_error(err, ManageCLIError.BucketAlreadyExists);
            }
        });

        mocha.it('cli bucket delete', async function() {
            const action = nc_nsfs_manage_actions.DELETE;
            try {
                const res = await exec_manage_cli(type, action, { config_root, name: bucket_options.name });
                assert_response(action, type, res);
                await read_config_file(config_root, schema_dir, bucket_options.name);
                assert.fail('cli bucket delete failed - bucket config file exists after deletion');
            } catch (err) {
                assert.equal(err.code, 'ENOENT');
            }
        });

        mocha.it('cli bucket delete - should fail invalid option', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const bucket_options_with_invalid_option = { config_root, name, lala: 'lala'}; // lala invalid option
            try {
                add_res = await exec_manage_cli(type, action, bucket_options_with_invalid_option);
                assert.fail('should have failed with invalid option');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidArgument);
            }
        });

        mocha.it('cli bucket create on GPFS', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            const bucket_status = await exec_manage_cli(type, action, gpfs_bucket_options);
            assert_response(action, type, bucket_status, gpfs_bucket_options);
            const bucket = await read_config_file(config_root, schema_dir, gpfs_bucket_options.name);
            assert_bucket(bucket, gpfs_bucket_options);
            await assert_config_file_permissions(config_root, schema_dir, gpfs_bucket_options.name);
        });

        mocha.it('cli bucket update owner', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            gpfs_bucket_options.email = 'user2@noobaa.io';
            const bucket_status = await exec_manage_cli(type, action, gpfs_bucket_options);
            assert_response(action, type, bucket_status, gpfs_bucket_options);
            const bucket = await read_config_file(config_root, schema_dir, gpfs_bucket_options.name);
            assert_bucket(bucket, gpfs_bucket_options);
            await assert_config_file_permissions(config_root, schema_dir, gpfs_bucket_options.name);
        });

        mocha.it('cli bucket update to non GPFS', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            gpfs_bucket_options.fs_backend = '';
            const bucket_status = await exec_manage_cli(type, action, gpfs_bucket_options);
            // in the CLI we use empty string to unset the fs_backend
            // but as a parameter is it undefined property
            gpfs_bucket_options.fs_backend = undefined;
            assert_response(action, type, bucket_status, gpfs_bucket_options);
            const bucket = await read_config_file(config_root, schema_dir, gpfs_bucket_options.name);
            assert_bucket(bucket, gpfs_bucket_options);
            await assert_config_file_permissions(config_root, schema_dir, gpfs_bucket_options.name);
        });

        mocha.it('cli GPFS bucket delete', async function() {
            const action = nc_nsfs_manage_actions.DELETE;
            try {
                const res = await exec_manage_cli(type, action, { config_root, name: gpfs_bucket_options.name });
                assert_response(action, type, res);
                await read_config_file(config_root, schema_dir, gpfs_bucket_options.name);
                assert.fail('cli bucket delete failed - bucket config file exists after deletion');
            } catch (err) {
                assert.equal(err.code, 'ENOENT');
            }
        });

    });

    mocha.describe('cli invalid actions and types', async function() {

        mocha.it('cli account invalid_action', async function() {
            const type = nc_nsfs_manage_entity_types.ACCOUNT;
            const action = 'invalid_action';
            try {
                await exec_manage_cli(type, action, { config_root });
                assert.fail('should have failed with invalid action');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidAction);
            }
        });

        mocha.it('cli bucket invalid_action', async function() {
            const type = nc_nsfs_manage_entity_types.BUCKET;
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
            const action = nc_nsfs_manage_actions.ADD;
            try {
                await exec_manage_cli(type, action, { config_root });
                assert.fail('should have failed with invalid type');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidType);
            }
        });

    });

    mocha.describe('cli account flow', async function() {
        const type = nc_nsfs_manage_entity_types.ACCOUNT;
        const name = 'account1';
        const email = 'account1@noobaa.io';
        const gpfs_account = 'gpfs_account';
        const new_buckets_path = `${root_path}new_buckets_path_user1/`;
        const uid = 999;
        const gid = 999;
        const access_key = 'GIGiFAnjaaE7OKD5N7hA';
        const secret_key = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsDy3o+4h0oFR';
        let account_options = { config_root, name, email, new_buckets_path, uid, gid, access_key, secret_key };
        const gpfs_account_options = { ...account_options, name: gpfs_account, email: gpfs_account, fs_backend: 'GPFS' };
        const accounts_schema_dir = 'accounts';
        const access_keys_schema_dir = 'access_keys';
        let updating_options = account_options;
        let compare_details; // we will use it for update account and compare the results
        let add_res;

        mocha.it('cli account create', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            add_res = await exec_manage_cli(type, action, account_options);
            assert_response(action, type, add_res, account_options);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            assert_account(account, account_options);
            await assert_config_file_permissions(config_root, accounts_schema_dir, name);
        });

        mocha.it('cli account status', async function() {
            const action = nc_nsfs_manage_actions.STATUS;
            const account_status = await exec_manage_cli(type, action, { config_root, name: account_options.name });
            assert_response(action, type, account_status, account_options);
            const access_key_account_status = await exec_manage_cli(type, action, { config_root, access_key: account_options.access_key });
            assert_response(action, type, access_key_account_status, account_options);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            assert_account(account, account_options);
        });

        mocha.it('cli account status - account does not exist - should fail', async function() {
            const action = nc_nsfs_manage_actions.STATUS;
            try {
                await exec_manage_cli(type, action, { config_root, name: 'invalid_account' });
                assert.fail('should have failed with account does not exist');
            } catch (err) {
                assert_error(err, ManageCLIError.NoSuchAccountName);
            }
        });

        mocha.it('cli account status show_secrets', async function() {
            const action = nc_nsfs_manage_actions.STATUS;
            const account_status = await exec_manage_cli(type, action, { config_root, name: account_options.name, show_secrets: true });
            assert_response(action, type, account_status, account_options, true);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            assert_account(account, account_options);
        });

        mocha.it('cli account create - no uid gid - should fail', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            try {
                await exec_manage_cli(type, action, { config_root, name: account_options.name, access_key, secret_key, email: 'bla' });
                assert.fail('should have failed with account config should not be empty');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidAccountNSFSConfig);
            }
        });

        mocha.it('cli account create - no uid - should fail', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            try {
                await exec_manage_cli(type, action, { config_root, name: account_options.name, access_key, secret_key, email: 'bla', gid: 1001});
                assert.fail('should have failed with account config should include UID');
            } catch (err) {
                assert_error(err, ManageCLIError.MissingAccountNSFSConfigUID);
            }
        });

        mocha.it('cli account create - no gid - should fail', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            try {
                await exec_manage_cli(type, action, { config_root, name: account_options.name, access_key, secret_key, email: 'bla', uid: 1001});
                assert.fail('should have failed with account config should include GID');
            } catch (err) {
                assert_error(err, ManageCLIError.MissingAccountNSFSConfigGID);
            }
        });

        mocha.it('cli account create - new_buckets_path does not exist - should fail', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            try {
                await exec_manage_cli(type, action, { ...account_options, new_buckets_path: 'path_does/not_exist' });
                assert.fail('should have failed with new_buckets_path should be a valid dir path');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidAccountNewBucketsPath);
            }
        });

        mocha.it('cli account create - name exists - should fail', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            try {
                await exec_manage_cli(type, action, { ...account_options, access_key: 'GIGiFAnjaaE7OKrandom' });
                assert.fail('should have failed with account name already exists');
            } catch (err) {
                assert_error(err, ManageCLIError.AccountNameAlreadyExists);
            }
        });

        mocha.it('cli account create - access_key exists - should fail', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            try {
                await exec_manage_cli(type, action, { ...account_options, name: 'random' });
                assert.fail('should have failed with account access key already exists');
            } catch (err) {
                assert_error(err, ManageCLIError.AccountAccessKeyAlreadyExists);
            }
        });

        mocha.it('cli account list', async function() {
            const action = nc_nsfs_manage_actions.LIST;
            const account_list = await exec_manage_cli(type, action, { config_root });
            const expected_list = [{ name }];
            assert_response(action, type, account_list, expected_list);
        });

        mocha.it('cli account list - wide', async function() {
            const action = nc_nsfs_manage_actions.LIST;
            const account_list = await exec_manage_cli(type, action, { config_root, wide: true });
            const expected_list = [account_options];
            assert_response(action, type, account_list, expected_list, undefined, true);
        });

        mocha.it('cli account update uid by name', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const update_options = {
                config_root,
                name,
                email: 'account2@noobaa.io',
                uid: 222,
                gid: 222,
                new_buckets_path: `${root_path}new_buckets_path_user2/`
            };
            await fs_utils.create_fresh_path(update_options.new_buckets_path);
            await fs_utils.file_must_exist(update_options.new_buckets_path);
            const update_response = await exec_manage_cli(type, action, update_options);
            updating_options = { ...updating_options, ...update_options };
            assert_response(action, type, update_response, updating_options);
            account_options = { ...account_options, ...update_options };
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            assert_account(account, account_options);
            assert.equal(JSON.parse(update_response).response.reply.creation_date, JSON.parse(add_res).response.reply.creation_date);
        });

        mocha.it('cli account delete by name', async function() {
            const action = nc_nsfs_manage_actions.DELETE;
            const res = await exec_manage_cli(type, action, { config_root, name: account_options.name });
            assert_response(action, type, res);
            try {
                await read_config_file(config_root, access_keys_schema_dir, account_options.access_key, true);
                throw new Error('cli account delete failed - account config link file exists after deletion');
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw new Error('cli account delete failed - read file failed with the following error - ', err.code);
                }
            }
            try {
                await read_config_file(config_root, accounts_schema_dir, account_options.name);
                throw new Error('cli account delete failed - account config file exists after deletion');
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw new Error('cli account delete failed - read file failed with the following error - ', err.code);
                }
            }
        });

        mocha.it('cli account create on GPFS', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            const account_status = await exec_manage_cli(type, action, gpfs_account_options);
            assert_response(action, type, account_status, gpfs_account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, gpfs_account_options.name);
            assert_account(account, gpfs_account_options);
            await assert_config_file_permissions(config_root, accounts_schema_dir, gpfs_account_options.name);
        });

        mocha.it('cli account update owner', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const account_options_for_update_owner = {
                config_root: gpfs_account_options.config_root, // needed for exec_manage_cli function
                name: gpfs_account_options.name,
                fs_backend: gpfs_account_options.fs_backend, // added this not to mess up the comparison
                email: 'blalal' //update the name
            };
            const account_status = await exec_manage_cli(type, action, account_options_for_update_owner);
            compare_details = {
                ...gpfs_account_options,
                ...account_options_for_update_owner,
            };
            assert_response(action, type, account_status, compare_details);
            const account = await read_config_file(config_root, accounts_schema_dir, gpfs_account_options.name);
            assert_account(account, compare_details);
            await assert_config_file_permissions(config_root, accounts_schema_dir, gpfs_account_options.name);
        });

        mocha.it('cli account update to non GPFS', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const account_options_for_update_fs_backend = {
                config_root: gpfs_account_options.config_root, // needed for exec_manage_cli function
                name: gpfs_account_options.name,
                fs_backend: '', // remove the 'GPFS'
            };
            const account_status = await exec_manage_cli(type, action, account_options_for_update_fs_backend);
            compare_details = {
                ...compare_details,
                ...account_options_for_update_fs_backend,
            };
            // in the CLI we use empty string to unset the fs_backend
            // but as a parameter is it undefined property
            compare_details.fs_backend = undefined;
            assert_response(action, type, account_status, compare_details);
            const account = await read_config_file(config_root, accounts_schema_dir, gpfs_account_options.name);
            assert_account(account, compare_details);
            await assert_config_file_permissions(config_root, accounts_schema_dir, gpfs_account_options.name);
        });

        mocha.it('cli account delete', async function() {
            const action = nc_nsfs_manage_actions.DELETE;
            try {
                const res = await exec_manage_cli(type, action, { config_root, name: gpfs_account_options.name });
                assert_response(action, type, res);
                await read_config_file(config_root, accounts_schema_dir, gpfs_account_options.name);
                assert.fail('cli account delete failed - account config file exists after deletion');
            } catch (err) {
                assert.equal(err.code, 'ENOENT');
            }
        });
    });

    mocha.describe('cli account flow - updates', async function() {
        this.timeout(50000); // eslint-disable-line no-invalid-this
        const type = nc_nsfs_manage_entity_types.ACCOUNT;
        const name1 = 'account1';
        const name2 = 'account2';
        const email = 'account1@noobaa.io';
        const new_buckets_path = `${root_path}new_buckets_path_user1/`;
        const uid = 999;
        const gid = 999;
        const access_key = 'GIGiFAnjaaE7OKD5N7hA';
        const secret_key = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsDy3o+4h0oFR';
        const account1_options = { config_root, name: name1, email, new_buckets_path, uid, gid, access_key, secret_key };
        const account1_options_for_delete = { config_root, name: name1 };
        const account2_options = { config_root, name: 'account2', email, new_buckets_path, uid, gid, access_key: 'BISiDSnjaaE7OKD5N7hB', secret_key };
        const account2_options_for_delete = { config_root, name: name2 };
        mocha.before(async () => {
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            const action = nc_nsfs_manage_actions.ADD;
            await exec_manage_cli(type, action, account1_options);
            await exec_manage_cli(type, action, account2_options);
        });
        mocha.after(async () => {
            await fs_utils.folder_delete(new_buckets_path);
            const action = nc_nsfs_manage_actions.DELETE;
            await exec_manage_cli(type, action, account1_options_for_delete);
            await exec_manage_cli(type, action, account2_options_for_delete);
        });

        mocha.it('cli account2 update - new_name already exists', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            try {
                await exec_manage_cli(type, action, { ...account2_options, new_name: 'account1' });
                assert.fail('should have failed with account name already exists');
            } catch (err) {
                assert_error(err, ManageCLIError.AccountNameAlreadyExists);
            }
        });

        mocha.it('cli account2 update - new_access_key already exists', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
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
        const type = nc_nsfs_manage_entity_types.ACCOUNT;
        const name = 'account2';
        const email = 'account2@noobaa.io';
        const new_buckets_path = `${root_path}new_buckets_path_user2/`;
        const distinguished_name = 'moti1003';
        const access_key = 'GIGiFAnjaaE7OKD5N7hB';
        const secret_key = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsDy3o+4h0oFr';
        let account_options = { config_root, name, email, new_buckets_path, distinguished_name, access_key, secret_key };
        const accounts_schema_dir = 'accounts';
        const access_keys_schema_dir = 'access_keys';

        mocha.it('cli account create', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            const res = await exec_manage_cli(type, action, account_options);
            assert_response(action, type, res, account_options);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            assert_account(account, account_options);
        });

        mocha.it('cli account update distinguished_name', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const update_options = {
                config_root,
                name,
                distinguished_name: 'moti1004',
            };
            const res = await exec_manage_cli(type, action, update_options);
            account_options = { ...account_options, ...update_options };
            assert_response(action, type, res, account_options);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            assert_account(account, account_options);
        });

        mocha.it('cli account delete by name', async function() {
            const action = nc_nsfs_manage_actions.DELETE;
            const res = await exec_manage_cli(type, action, { config_root, name: account_options.name });
            assert_response(action, type, res);
            try {
                await read_config_file(config_root, access_keys_schema_dir, access_key, true);
                throw new Error('cli account delete failed - account config file exists after deletion');
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw new Error('cli account delete failed - read file failed with the following error - ', err.code);
                }
            }
            try {
                await read_config_file(config_root, accounts_schema_dir, account_options.name);
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
        const type = nc_nsfs_manage_entity_types.IPWHITELIST;
        const config_options = { ENDPOINT_FORKS: 1, UV_THREADPOOL_SIZE: 4 };
        mocha.before(async () => {
            await write_config_file(config_root, '', 'config', config_options);
        });
        mocha.after(async () => {
            fs_utils.file_delete(path.join(config_root, 'config.json'));
        });

        mocha.it('cli add whitelist ips first time (IPV4 format)', async function() {
            const ips = ['127.0.0.1']; // IPV4 format
            const res = await exec_manage_cli(type, '', { config_root, ips: JSON.stringify(ips) });
            config_options.NSFS_WHITELIST = ips;
            const config_data = await read_config_file(config_root, '', 'config');
            assert_response('', type, res, ips);
            assert_whitelist(config_data, config_options);
        });

        mocha.it('cli update whitelist ips (IPV6 expanded format)', async function() {
            const ips = ['0000:0000:0000:0000:0000:ffff:7f00:0002']; // IPV6 expanded format
            const res = await exec_manage_cli(type, '', { config_root, ips: JSON.stringify(ips) });
            config_options.NSFS_WHITELIST = ips;
            const config_data = await read_config_file(config_root, '', 'config');
            assert_response('', type, res, ips);
            assert_whitelist(config_data, config_options);
        });

        mocha.it('cli update whitelist ips (IPV6 compressed format)', async function() {
            const ips = ['::ffff:7f00:3']; // IPV6 compressed format
            const res = await exec_manage_cli(type, '', { config_root, ips: JSON.stringify(ips) });
            config_options.NSFS_WHITELIST = ips;
            const config_data = await read_config_file(config_root, '', 'config');
            assert_response('', type, res, ips);
            assert_whitelist(config_data, config_options);
        });

        mocha.it('cli whitelist ips is empty', async function() {
            try {
                await exec_manage_cli(type, '', { config_root, ips: '' });
                assert.fail('should have failed with whitelist ips should not be empty.');
            } catch (err) {
                assert_error(err, ManageCLIError.MissingWhiteListIPFlag);
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

async function read_config_file(config_root, schema_dir, config_file_name, is_symlink) {
    const config_path = path.join(config_root, schema_dir, config_file_name + (is_symlink ? '.symlink' : '.json'));
    const { data } = await nb_native().fs.readFile(DEFAULT_FS_CONFIG, config_path);
    const config = JSON.parse(data.toString());
    return config;
}

async function write_config_file(config_root, schema_dir, config_file_name, data, is_symlink) {
    const config_path = path.join(config_root, schema_dir, config_file_name + (is_symlink ? '.symlink' : '.json'));
    await nb_native().fs.writeFile(DEFAULT_FS_CONFIG, config_path,
        Buffer.from(JSON.stringify(data)), {
            mode: config_module.BASE_MODE_FILE,
        });
}

async function assert_config_file_permissions(config_root, schema_dir, config_file_name, is_symlink) {
    const config_path = path.join(config_root, schema_dir, config_file_name + (is_symlink ? '.symlink' : '.json'));
    const { stat } = await nb_native().fs.readFile(DEFAULT_FS_CONFIG, config_path);
    // 33152 means 600 (only owner has read and write permissions)
    assert.equal(stat.mode, 33152);
}

function assert_error(err, expect_error) {
    const parsed_err = JSON.parse(err.stdout);
    assert.equal(parsed_err.error.code, expect_error.code);
}

function assert_response(action, type, actual_res, expected_res, show_secrets, wide) {
    const parsed = JSON.parse(actual_res);
    if (type === nc_nsfs_manage_entity_types.IPWHITELIST) {
        assert.equal(parsed.response.code, ManageCLIResponse.WhiteListIPUpdated.code);
        assert.deepStrictEqual(parsed.response.reply, expected_res);
    } else if (type === nc_nsfs_manage_entity_types.BUCKET) {
        if (action === nc_nsfs_manage_actions.STATUS ||
            action === nc_nsfs_manage_actions.ADD ||
            action === nc_nsfs_manage_actions.UPDATE) {
            assert_bucket(parsed.response.reply, expected_res);
        } else if (action === nc_nsfs_manage_actions.DELETE) {
            assert.equal(parsed.response.code, ManageCLIResponse.BucketDeleted.code);
        } else if (action === nc_nsfs_manage_actions.LIST) {
            assert.equal(parsed.response.reply.length, expected_res.length);
            for (let i = 0; i < parsed.response.reply.length; i++) {
                const name = parsed.response.reply[i].name;
                const expected_res_by_name = expected_res.find(expected => expected.name === name);
                if (wide) {
                    assert_bucket(parsed.response.reply[i], expected_res_by_name);
                } else {
                    assert.deepEqual(parsed.response.reply[i], expected_res_by_name);

                }
            }
        } else {
            assert.fail(`Invalid command action - ${action}`);
        }
    } else if (type === nc_nsfs_manage_entity_types.ACCOUNT) {
        if (action === nc_nsfs_manage_actions.STATUS ||
            action === nc_nsfs_manage_actions.ADD ||
            action === nc_nsfs_manage_actions.UPDATE) {
            assert_account(parsed.response.reply, expected_res, !show_secrets);
        } else if (action === nc_nsfs_manage_actions.DELETE) {
            assert.equal(parsed.response.code, ManageCLIResponse.AccountDeleted.code);
        } else if (action === nc_nsfs_manage_actions.LIST) {
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

function assert_bucket(bucket, bucket_options) {
    assert.strictEqual(bucket.name, bucket_options.name);
    assert.strictEqual(bucket.system_owner, bucket_options.email);
    assert.strictEqual(bucket.bucket_owner, bucket_options.email);
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
    assert.equal(account.email, account_options.email);
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
    assert.strictEqual(config_data.NSFS_WHITELIST.length, config_options.NSFS_WHITELIST.length);
    return true;
}

