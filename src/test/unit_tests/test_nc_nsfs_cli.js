/* Copyright (C) 2016 NooBaa */
'use strict';
/* eslint-disable max-lines-per-function */

const _ = require('lodash');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const P = require('../../util/promise');
const fs_utils = require('../../util/fs_utils');
const os_util = require('../../util/os_utils');
const nb_native = require('../../util/nb_native');
const config_module = require('../../../config');
const { ManageCLIError } = require('../../manage_nsfs/manage_nsfs_cli_errors');
const { ManageCLIResponse } = require('../../manage_nsfs/manage_nsfs_cli_responses');

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

const nc_nsfs_manage_entity_types = {
    BUCKET: 'bucket',
    ACCOUNT: 'account',
    IPWHITELIST: 'whitelist',
};

const nc_nsfs_manage_actions = {
    ADD: 'add',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    STATUS: 'status'
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

    mocha.describe('cli bucket flow - happy path', async function() {
        const type = nc_nsfs_manage_entity_types.BUCKET;
        const name = 'bucket1';
        const owner_email = 'user1@noobaa.io';
        const bucket_path = `${root_path}${name}/`;
        const schema_dir = 'buckets';
        let bucket_options = { config_root, name, owner_email, bucket_path };

        mocha.it('cli bucket create', async function() {
            const action = nc_nsfs_manage_actions.ADD;
            await fs_utils.create_fresh_path(bucket_path);
            await fs_utils.file_must_exist(bucket_path);
            const bucket_status = await exec_manage_cli(type, action, bucket_options);
            assert_response(action, type, bucket_status, bucket_options);
            const bucket = await read_config_file(config_root, schema_dir, name);
            assert_bucket(bucket, bucket_options);
            await assert_config_file_permissions(config_root, schema_dir, name);
        });

        mocha.it('cli bucket status', async function() {
            const action = nc_nsfs_manage_actions.STATUS;
            const bucket_status = await exec_manage_cli(type, action, { config_root, name });
            assert_response(action, type, bucket_status, bucket_options);
            const bucket = await read_config_file(config_root, schema_dir, name);
            assert_bucket(bucket, bucket_options);
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
            const expected_list = [{ name }];
            assert_response(action, type, bucket_list, expected_list);
        });

        mocha.it('cli bucket list - wide', async function() {
            const action = nc_nsfs_manage_actions.LIST;
            const bucket_list = await exec_manage_cli(type, action, { config_root, wide: true });
            const expected_list = [bucket_options];
            assert_response(action, type, bucket_list, expected_list, undefined, true);
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

        mocha.it('cli bucket update owner_email', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const update_options = { config_root, owner_email: 'user2@noobaa.io', name };
            await exec_manage_cli(type, action, update_options);
            bucket_options = { ...bucket_options, ...update_options };
            const bucket = await read_config_file(config_root, schema_dir, name);
            assert_bucket(bucket, bucket_options);
            await assert_config_file_permissions(config_root, schema_dir, name);
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
                assert_error(err, ManageCLIError.InvalidConfigType);
            }
        });

    });
    mocha.describe('cli account flow', async function() {
        const type = nc_nsfs_manage_entity_types.ACCOUNT;
        const name = 'account1';
        const email = 'account1@noobaa.io';
        const new_buckets_path = `${root_path}new_buckets_path_user1/`;
        const uid = 999;
        const gid = 999;
        const access_key = 'GIGiFAnjaaE7OKD5N7hA';
        const secret_key = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsDy3o+4h0oFR';
        let account_options = { config_root, name, email, new_buckets_path, uid, gid, access_key, secret_key };
        const accounts_schema_dir = 'accounts';
        const access_keys_schema_dir = 'access_keys';
        let updating_options = account_options;

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
            await assert_config_file_permissions(config_root, accounts_schema_dir, name);
        });

        mocha.it('cli account status', async function() {
            const action = nc_nsfs_manage_actions.STATUS;
            const account_status = await exec_manage_cli(type, action, { config_root, name: account_options.name });
            assert_response(action, type, account_status, account_options);
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
                await exec_manage_cli(type, action, { config_root, access_key, secret_key, email: 'bla' });
                assert.fail('should have failed with account config should not be empty');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidAccountNSFSConfig);
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
                await exec_manage_cli(type, action, { ...account_options, access_key: 'random' });
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
            const bucket_list = await exec_manage_cli(type, action, { config_root });
            const expect_list = [{ name }];
            assert_response(action, type, bucket_list, expect_list);
        });

        mocha.it('cli account list - wide', async function() {
            const action = nc_nsfs_manage_actions.LIST;
            const account_list = await exec_manage_cli(type, action, { config_root, wide: true });
            const expected_list = [account_options];
            assert_response(action, type, account_list, expected_list, undefined, true);
        });

        mocha.it('cli account update uid by access key', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const update_options = {
                config_root,
                access_key: account_options.access_key,
                secret_key: account_options.secret_key,
                email: 'account2@noobaa.io',
                uid: 222,
                gid: 222
            };
            const update_response = await exec_manage_cli(type, action, update_options);
            updating_options = { ...updating_options, ...update_options };
            assert_response(action, type, update_response, updating_options);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            account_options = { ...account_options, ...update_options };
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            assert_account(account, account_options);
            await assert_config_file_permissions(config_root, accounts_schema_dir, name);
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
        });

        mocha.it('cli account update name by access key', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const update_options = {
                config_root,
                new_name: 'account1_new_name',
                access_key: account_options.access_key,
                secret_key: account_options.secret_key,
            };
            account_options.new_name = 'account1_new_name';
            const update_response = await exec_manage_cli(type, action, update_options);
            updating_options = { ...updating_options, name: update_options.new_name };
            assert_response(action, type, update_response, updating_options);
            account_options = { ...account_options, new_name: undefined, name: update_options.new_name };
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, account_options.name);
            assert_account(account, account_options);
        });

        mocha.it('cli account update access key by name', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const update_options = {
                config_root,
                new_access_key: 'BIGiFAnjaaE7OKD5N7hB',
                name: account_options.name
            };
            const update_response = await exec_manage_cli(type, action, update_options);
            updating_options = { ...updating_options, access_key: update_options.new_access_key };
            assert_response(action, type, update_response, updating_options);
            account_options = { ...account_options, new_access_key: undefined, access_key: update_options.new_access_key };
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, account_options.access_key, true);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, account_options.name);
            assert_account(account, account_options);
        });

        mocha.it('cli account update access key & new_name by name', async function() {
            const action = nc_nsfs_manage_actions.UPDATE;
            const update_options = {
                config_root,
                new_access_key: 'BIGiFAnjaaE6OGD5N7hB',
                new_name: 'account2_new_name',
                name: account_options.name
            };
            await exec_manage_cli(type, action, update_options);
            account_options = {
                ...account_options,
                new_access_key: undefined,
                new_name: undefined,
                access_key: update_options.new_access_key,
                name: update_options.new_name
            };
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, account_options.access_key, true);
            assert_account(account_symlink, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, account_options.name);
            assert_account(account, account_options);
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
    });

    mocha.describe('cli account flow - updates', async function() {
        this.timeout(50000); // eslint-disable-line no-invalid-this
        const type = nc_nsfs_manage_entity_types.ACCOUNT;
        const name = 'account1';
        const email = 'account1@noobaa.io';
        const new_buckets_path = `${root_path}new_buckets_path_user1/`;
        const uid = 999;
        const gid = 999;
        const access_key = 'GIGiFAnjaaE7OKD5N7hA';
        const secret_key = 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsDy3o+4h0oFR';
        const account1_options = { config_root, name, email, new_buckets_path, uid, gid, access_key, secret_key };
        const account2_options = { config_root, name: 'account2', email, new_buckets_path, uid, gid, access_key: 'BISiDSnjaaE7OKD5N7hB', secret_key };
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
            await exec_manage_cli(type, action, account1_options);
            await exec_manage_cli(type, action, account2_options);
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
            try {
                await exec_manage_cli(type, action, { ...account2_options, new_access_key: 'GIGiFAnjaaE7OKD5N7hA' });
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

        mocha.it('cli account delete by access key', async function() {
            const action = nc_nsfs_manage_actions.DELETE;
            const res = await exec_manage_cli(type, action, { config_root, access_key, secret_key });
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

        mocha.it('cli account delete by name', async function() {
            let action = nc_nsfs_manage_actions.ADD;
            await exec_manage_cli(type, action, account_options);
            action = nc_nsfs_manage_actions.DELETE;
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
        const ips = ['127.0.0.1', '192.000.10.000', '3002:0bd6:0000:0000:0000:ee00:0033:999'];
        mocha.before(async () => {
            await write_config_file(config_root, '', 'config', config_options);
        });
        mocha.after(async () => {
            fs_utils.file_delete(path.join(config_root, 'config.json'));
        });

        mocha.it('cli add whitelist ips first time', async function() {
            const res = await exec_manage_cli(type, '', { config_root, ips: JSON.stringify(ips) });
            config_options.NSFS_WHITELIST = ips;
            const config_data = await read_config_file(config_root, '', 'config');
            assert_response('', type, res, ips);
            assert_whitelist(config_data, config_options);
        });

        mocha.it('cli update whitelist ips', async function() {
            ips.push('100.000.00.000');
            const res = await exec_manage_cli(type, '', { config_root, ips: JSON.stringify(ips) });
            config_options.NSFS_WHITELIST = ips;
            const config_data = await read_config_file(config_root, '', 'config');
            assert_response('', type, res, ips);
            assert_whitelist(config_data, config_options);
        });

        mocha.it('cli whitelist ips is empty', async function() {
            try {
                await exec_manage_cli(type, '', { config_root, ips: '' });
                config_options.NSFS_WHITELIST = ips;
                assert.fail('should have failed withwhitelist ips should not be empty.');
            } catch (err) {
                assert_error(err, ManageCLIError.MissingWhiteListIPFlag);
            }
        });

        mocha.it('cli whitelist formate is invalid', async function() {
            try {
                await exec_manage_cli(type, '', { config_root, ips: JSON.stringify(ips) + 'invalid' });
                config_options.NSFS_WHITELIST = ips;
                assert.fail('should have failed with whitelist ips with invalid body format');
            } catch (err) {
                assert_error(err, ManageCLIError.InvalidWhiteListIPFormat);
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
    assert.ok(stat.mode, 33152);
}

function assert_error(err, expect_error) {
    const parsed_err = JSON.parse(err.stdout);
    assert.ok(parsed_err.error.code, expect_error.code);
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
            if (wide) {
                for (let i = 0; i < parsed.response.reply.length; i++) {
                    assert_bucket(parsed.response.reply[i], expected_res[i]);
                }
            } else {
                assert.deepEqual(parsed.response.reply, expected_res);
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
    assert.strictEqual(bucket.system_owner, bucket_options.owner_email);
    assert.strictEqual(bucket.bucket_owner, bucket_options.owner_email);
    assert.strictEqual(bucket.path, bucket_options.bucket_path);
    assert.strictEqual(bucket.should_create_underlying_storage, false);
    assert.strictEqual(bucket.versioning, 'DISABLED');
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
    } else {
        assert.equal(account.nsfs_account_config.uid, account_options.uid);
        assert.equal(account.nsfs_account_config.gid, account_options.gid);
    }
    assert.equal(account.nsfs_account_config.new_buckets_path, account_options.new_buckets_path);
    return true;
}

function assert_whitelist(config_data, config_options) {
    assert.strictEqual(config_data.ENDPOINT_FORKS, config_options.ENDPOINT_FORKS);
    assert.strictEqual(config_data.UV_THREADPOOL_SIZE, config_options.UV_THREADPOOL_SIZE);
    assert.strictEqual(config_data.NSFS_WHITELIST.length, config_options.NSFS_WHITELIST.length);
    return true;
}

async function exec_manage_cli(type, action, options) {
    const bucket_flags = (options.name ? `--name ${options.name}` : ``) +
        (options.owner_email ? ` --email ${options.owner_email}` : ``) +
        (options.bucket_path ? ` --path ${options.bucket_path}` : ``);

    const account_flags = (options.name ? ` --name ${options.name}` : ``) +
        (options.email ? ` --email ${options.email}` : ``) +
        (options.new_buckets_path ? ` --new_buckets_path ${options.new_buckets_path}` : ``) +
        (options.access_key ? ` --access_key ${options.access_key}` : ``) +
        (options.secret_key ? ` --secret_key ${options.secret_key}` : ``) +
        (options.uid ? ` --uid ${options.uid}` : ``) +
        (options.gid ? ` --gid ${options.gid}` : ``) +
        (options.distinguished_name ? ` --user ${options.distinguished_name}` : ` `) +
        (options.show_secrets ? ` --show_secrets ${options.show_secrets}` : ``);


    const whiteist_flags = (options.ips ? ` --ips '${options.ips}'` : ``);

    const update_identity_flags = (options.new_name ? ` --new_name ${options.new_name}` : ``) +
        (options.new_access_key ? ` --new_access_key ${options.new_access_key}` : ``);
    let flags = (type === nc_nsfs_manage_entity_types.BUCKET ? bucket_flags : account_flags) + update_identity_flags;
    flags = (type === nc_nsfs_manage_entity_types.IPWHITELIST ? whiteist_flags : flags);
    const wide_list = (options.wide ? ` --wide ${options.wide}` : ``);
    const cmd = `node src/cmd/manage_nsfs ${type} ${action} --config_root ${options.config_root} ${flags} ${wide_list}`;
    const res = await os_util.exec(cmd, { return_stdout: true });
    return res;
}
