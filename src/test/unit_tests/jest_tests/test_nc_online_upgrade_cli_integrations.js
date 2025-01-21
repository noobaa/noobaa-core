/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const path = require('path');
const fs_utils = require('../../../util/fs_utils');
const { exec_manage_cli, TMP_PATH, create_system_json } = require('../../system_tests/test_utils');
const { folder_delete, create_fresh_path } = require('../../../util/fs_utils');
const { TYPES, ACTIONS } = require('../../../manage_nsfs/manage_nsfs_constants');
const { ManageCLIError } = require('../../../manage_nsfs/manage_nsfs_cli_errors');
const { ManageCLIResponse } = require('../../../manage_nsfs/manage_nsfs_cli_responses');

const config_root = path.join(TMP_PATH, 'test_online_upgrade_cli_integrations');
const { ConfigFS } = require('../../../sdk/config_fs');
const config_fs = new ConfigFS(config_root);
const default_new_buckets_path = path.join(TMP_PATH, 'default_new_buckets_path_online_upgrade_cli_integrations_test');
const bucket_storage_path = path.join(default_new_buckets_path, 'bucket1');
const old_config_dir_version = '0.0.0';

const default_account_options = {
    config_root,
    name: 'account1',
    new_buckets_path: default_new_buckets_path,
    uid: process.getuid(),
    gid: process.getgid(),
};

const default_bucket_options = {
    config_root,
    name: 'bucket1',
    path: bucket_storage_path,
    owner: default_account_options.name
};

describe('online upgrade CLI bucket operations tests', function() {
    beforeAll(async () => {
        await create_fresh_path(config_root);
        await create_fresh_path(default_new_buckets_path, 770);
        await fs_utils.file_must_exist(default_new_buckets_path);
        await create_default_account();
        await create_fresh_path(bucket_storage_path, 770);
        await fs_utils.file_must_exist(bucket_storage_path);
    });

    afterAll(async () => {
        await folder_delete(config_root);
        await folder_delete(default_new_buckets_path);
    });

    afterEach(async () => {
        await fs_utils.file_delete(config_fs.system_json_path);
        await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, { config_root, name: default_bucket_options.name }, true);
    });

    it('create bucket - host is blocked for config dir updates - should fail', async function() {
        await create_system_json(config_fs, old_config_dir_version);
        const res = await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, default_bucket_options, true);
        expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.ConfigDirUpdateBlocked.message);
    });

    it('create bucket - host is not blocked for config dir updates', async function() {
        await create_system_json(config_fs);
        const res = await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, default_bucket_options, true);
        expect(JSON.parse(res).response.code).toBe(ManageCLIResponse.BucketCreated.code);
    });

    it('update bucket - host is blocked for config dir updates - should fail', async function() {
        await create_default_bucket();
        await create_system_json(config_fs, old_config_dir_version);
        const update_bucket_options = { ...default_bucket_options, name: default_bucket_options.name, new_name: 'bucket2' };
        const update_res = await exec_manage_cli(TYPES.BUCKET, ACTIONS.UPDATE, update_bucket_options, true);
        expect(JSON.parse(update_res.stdout).error.message).toBe(ManageCLIError.ConfigDirUpdateBlocked.message);
    });

    it('update bucket - host is not blocked for config dir updates', async function() {
        await create_default_bucket();
        await create_system_json(config_fs);
        const update_bucket_options = { ...default_bucket_options, name: default_bucket_options.name, new_name: 'bucket2' };
        const update_res = await exec_manage_cli(TYPES.BUCKET, ACTIONS.UPDATE, update_bucket_options, true);
        expect(JSON.parse(update_res).response.code).toBe(ManageCLIResponse.BucketUpdated.code);
    });

    it('delete bucket - host is blocked for config dir updates - should fail', async function() {
        await create_default_bucket();
        await create_system_json(config_fs, old_config_dir_version);
        const delete_bucket_options = { config_root, name: default_bucket_options.name };
        const delete_res = await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, delete_bucket_options, true);
        expect(JSON.parse(delete_res.stdout).error.message).toBe(ManageCLIError.ConfigDirUpdateBlocked.message);
    });

    it('delete bucket - host is not blocked for config dir updates', async function() {
        await create_default_bucket();
        await create_system_json(config_fs);
        const delete_bucket_options = { config_root, name: default_bucket_options.name };
        const delete_res = await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, delete_bucket_options, true);
        expect(JSON.parse(delete_res).response.code).toBe(ManageCLIResponse.BucketDeleted.code);
    });

    it('list buckets - old config dir version - success', async function() {
        await create_default_bucket();
        await create_system_json(config_fs, old_config_dir_version);
        const list_bucket_options = { config_root };
        const list_res = await exec_manage_cli(TYPES.BUCKET, ACTIONS.LIST, list_bucket_options, true);
        expect(JSON.parse(list_res).response.code).toBe(ManageCLIResponse.BucketList.code);
    });

    it('bucket status - old config dir version - success', async function() {
        await create_default_bucket();
        await create_system_json(config_fs, old_config_dir_version);
        const status_bucket_options = { config_root, name: default_bucket_options.name };
        const status_res = await exec_manage_cli(TYPES.BUCKET, ACTIONS.STATUS, status_bucket_options, true);
        expect(JSON.parse(status_res).response.code).toBe(ManageCLIResponse.BucketStatus.code);
    });
});

describe('online upgrade CLI account operations tests', function() {
    beforeAll(async () => {
        await create_fresh_path(config_root);
        await create_fresh_path(default_new_buckets_path, 770);
    });

    afterAll(async () => {
        await folder_delete(config_root);
        await folder_delete(default_new_buckets_path);
    });

    afterEach(async () => {
        await fs_utils.file_delete(config_fs.system_json_path);
        await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: default_account_options.name }, true);
    });

    it('create account - host is blocked for config dir updates - should fail', async function() {
        await create_system_json(config_fs, old_config_dir_version);
        const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, default_account_options, true);
        expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.ConfigDirUpdateBlocked.message);
    });

    it('create account - host is not blocked for config dir updates', async function() {
        await create_system_json(config_fs);
        const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, default_account_options, true);
        expect(JSON.parse(res).response.code).toBe(ManageCLIResponse.AccountCreated.code);
    });

    it('update account - host is blocked for config dir updates - should fail', async function() {
        await create_default_account();
        await create_system_json(config_fs, old_config_dir_version);
        const update_account_options = { ...default_account_options, name: default_account_options.name, new_name: 'account2' };
        const update_res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.UPDATE, update_account_options, true);
        expect(JSON.parse(update_res.stdout).error.message).toBe(ManageCLIError.ConfigDirUpdateBlocked.message);
    });

    it('update account - host is not blocked for config dir updates', async function() {
        await create_default_account();
        await create_system_json(config_fs);
        const update_account_options = { ...default_account_options, name: default_account_options.name, new_name: 'account2' };
        const update_res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.UPDATE, update_account_options, true);
        expect(JSON.parse(update_res).response.code).toBe(ManageCLIResponse.AccountUpdated.code);
    });

    it('delete account - host is blocked for config dir updates - should fail', async function() {
        await create_default_account();
        await create_system_json(config_fs, old_config_dir_version);
        const delete_account_options = { config_root, name: default_account_options.name };
        const delete_res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, delete_account_options, true);
        expect(JSON.parse(delete_res.stdout).error.message).toBe(ManageCLIError.ConfigDirUpdateBlocked.message);
    });

    it('delete account - host is not blocked for config dir updates', async function() {
        await create_default_account();
        await create_system_json(config_fs);
        const delete_account_options = { config_root, name: default_account_options.name };
        const delete_res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, delete_account_options, true);
        expect(JSON.parse(delete_res).response.code).toBe(ManageCLIResponse.AccountDeleted.code);
    });

    it('list accounts - old config dir version - success', async function() {
        await create_default_account();
        await create_system_json(config_fs, old_config_dir_version);

        const list_account_options = { config_root };
        const list_res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.LIST, list_account_options, true);
        expect(JSON.parse(list_res).response.code).toBe(ManageCLIResponse.AccountList.code);
    });

    it('account status - old config dir version - success', async function() {
        await create_default_account();
        await create_system_json(config_fs, old_config_dir_version);
        const status_account_options = { config_root, name: default_account_options.name };
        const status_res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.STATUS, status_account_options, true);
        expect(JSON.parse(status_res).response.code).toBe(ManageCLIResponse.AccountStatus.code);
    });
});

/**
 * create_default_bucket creates the default bucket for tests that require an existing bucket
 * @returns {Promise<Void>}
 */
async function create_default_bucket() {
    const res = await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, default_bucket_options, true);
    expect(JSON.parse(res).response.code).toBe(ManageCLIResponse.BucketCreated.code);
}

/**
 * create_default_bucket creates the default bucket for tests that require an existing bucket
 * @returns {Promise<Void>}
 */
async function create_default_account() {
    const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, default_account_options, true);
    expect(JSON.parse(res).response.code).toBe(ManageCLIResponse.AccountCreated.code);
}
