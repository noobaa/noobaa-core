/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const fs = require('fs');
const path = require('path');
const fs_utils = require('../../../util/fs_utils');
const { exec_manage_cli, set_path_permissions_and_owner, TMP_PATH, set_nc_config_dir_in_config } = require('../../system_tests/test_utils');
const { TYPES, ACTIONS } = require('../../../manage_nsfs/manage_nsfs_constants');
const ManageCLIError = require('../../../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../../../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;

const tmp_fs_path = path.join(TMP_PATH, 'test_nc_invalid_mkm_integration');
const config_root = path.join(tmp_fs_path, 'config_root_account_mkm_integration');
const root_path = path.join(tmp_fs_path, 'root_path_account_mkm_integration/');
const defaults = {
    _id: 'account1',
    type: TYPES.ACCOUNT,
    name: 'account1',
    new_buckets_path: `${root_path}new_buckets_path_mkm_integration/`,
    uid: 999,
    gid: 999,
    access_key: 'GIGiFAnjaaE7OKD5N7hA',
    secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
};

describe('manage nsfs cli account flow + fauly master key flow', () => {
    describe('cli account ops - master key is missing', () => {
        beforeEach(async () => {
            await setup_nc_system_and_first_account();
            // delete master key json file
            await fs_utils.file_delete(`${config_root}/master_keys.json`);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('should fail | cli create update', async () => {
            try {
                await update_account();
                fail('should have failed with InvalidMasterKey');
            } catch (err) {
                expect(JSON.parse(err.stdout).error.code).toBe(ManageCLIError.InvalidMasterKey.code);
            }
        });

        it('cli account list', async () => {
            const { name } = defaults;
            const list_res = await list_account_flow();
            expect(list_res.response.reply[0].name).toBe(name);
        });

        it('cli account status', async () => {
            const { name, uid, gid, new_buckets_path } = defaults;
            const status_res = await status_account();
            expect(status_res.response.reply.name).toBe(name);
            expect(status_res.response.reply.email).toBe(name);
            expect(status_res.response.reply.nsfs_account_config.uid).toBe(uid);
            expect(status_res.response.reply.nsfs_account_config.gid).toBe(gid);
            expect(status_res.response.reply.nsfs_account_config.new_buckets_path).toBe(new_buckets_path);
        });

        it('should fail | cli account status show secret ', async () => {
            try {
                await status_account(true);
                fail('should have failed with InvalidMasterKey');
            } catch (err) {
                expect(JSON.parse(err.stdout).error.code).toBe(ManageCLIError.InvalidMasterKey.code);
            }
        });

        it('cli account delete', async () => {
            const delete_res = await delete_account_flow();
            expect(delete_res.response.code).toBe(ManageCLIResponse.AccountDeleted.code);
        });
    });

    describe('cli account mkm integrations - active master key is corrupted', () => {

        beforeEach(async () => {
            await setup_nc_system_and_first_account();
            // corrupt active master key in master key json file
            const master_keys_json_path = `${config_root}/master_keys.json`;
            const master_keys_data = await fs.promises.readFile(master_keys_json_path);
            const master_keys_json = JSON.parse(master_keys_data.toString());
            master_keys_json.active_master_key = 'bla';
            await fs_utils.file_delete(master_keys_json_path);
            await fs.promises.writeFile(master_keys_json_path, JSON.stringify(master_keys_json));
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('should fail | cli create account', async () => {
            try {
                await create_account({ ...defaults, name: 'account_corrupted_mk' });
                fail('should have failed with InvalidMasterKey');
            } catch (err) {
                expect(JSON.parse(err.stdout).error.code).toBe(ManageCLIError.InvalidMasterKey.code);
            }
        });

        it('should fail | cli update account', async () => {
            try {
                await update_account();
                fail('should have failed with InvalidMasterKey');
            } catch (err) {
                expect(JSON.parse(err.stdout).error.code).toBe(ManageCLIError.InvalidMasterKey.code);
            }
        });

        it('cli account list', async () => {
            const { name } = defaults;
            const list_res = await list_account_flow();
            expect(list_res.response.reply[0].name).toBe(name);
        });

        it('cli account status', async () => {
            const { name, uid, gid, new_buckets_path } = defaults;
            const status_res = await status_account();
            expect(status_res.response.reply.name).toBe(name);
            expect(status_res.response.reply.email).toBe(name);
            expect(status_res.response.reply.nsfs_account_config.uid).toBe(uid);
            expect(status_res.response.reply.nsfs_account_config.gid).toBe(gid);
            expect(status_res.response.reply.nsfs_account_config.new_buckets_path).toBe(new_buckets_path);
        });

        it('should fail | cli account status show secret ', async () => {
            try {
                await status_account(true);
                fail('should have failed with InvalidMasterKey');
            } catch (err) {
                expect(JSON.parse(err.stdout).error.code).toBe(ManageCLIError.InvalidMasterKey.code);
            }
        });

        it('cli account delete', async () => {
            const delete_res = await delete_account_flow();
            expect(delete_res.response.code).toBe(ManageCLIResponse.AccountDeleted.code);
        });
    });
    describe('cli account mkm integrations - master_keys_by_id is corrupted', () => {

        beforeEach(async () => {
            await setup_nc_system_and_first_account();
            // corrupt master_keys_by_id in master key json file
            const master_keys_json_path = `${config_root}/master_keys.json`;
            const master_keys_data = await fs.promises.readFile(master_keys_json_path);
            const master_keys_json = JSON.parse(master_keys_data.toString());
            master_keys_json.master_keys_by_id = undefined;
            await fs_utils.file_delete(master_keys_json_path);
            await fs.promises.writeFile(master_keys_json_path, JSON.stringify(master_keys_json));
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('should fail | cli create account', async () => {
            try {
                await create_account({ ...defaults, name: 'account_corrupted_mk' });
                fail('should have failed with InvalidMasterKey');
            } catch (err) {
                expect(JSON.parse(err.stdout).error.code).toBe(ManageCLIError.InvalidMasterKey.code);
            }
        });

        it('should fail | cli update account', async () => {
            try {
                await update_account();
                fail('should have failed with InvalidMasterKey');
            } catch (err) {
                expect(JSON.parse(err.stdout).error.code).toBe(ManageCLIError.InvalidMasterKey.code);
            }
        });

        it('cli account list', async () => {
            const { name } = defaults;
            const list_res = await list_account_flow();
            expect(list_res.response.reply[0].name).toBe(name);
        });

        it('cli account status', async () => {
            const { name, uid, gid, new_buckets_path } = defaults;
            const status_res = await status_account();
            expect(status_res.response.reply.name).toBe(name);
            expect(status_res.response.reply.email).toBe(name);
            expect(status_res.response.reply.nsfs_account_config.uid).toBe(uid);
            expect(status_res.response.reply.nsfs_account_config.gid).toBe(gid);
            expect(status_res.response.reply.nsfs_account_config.new_buckets_path).toBe(new_buckets_path);
        });

        it('should fail | cli account status show secret ', async () => {
            try {
                await status_account(true);
                fail('should have failed with InvalidMasterKey');
            } catch (err) {
                expect(JSON.parse(err.stdout).error.code).toBe(ManageCLIError.InvalidMasterKey.code);
            }
        });

        it('cli account delete', async () => {
            const delete_res = await delete_account_flow();
            expect(delete_res.response.code).toBe(ManageCLIResponse.AccountDeleted.code);
        });
    });
});

async function create_account(account_options) {
    const action = ACTIONS.ADD;
    const { type, name, new_buckets_path, uid, gid } = account_options;
    const account_cmd_options = { config_root, name, new_buckets_path, uid, gid };
    const res = await exec_manage_cli(type, action, account_cmd_options);
    const parsed_res = JSON.parse(res);
    return parsed_res;
}

async function update_account() {
    const action = ACTIONS.UPDATE;
    const { type, name, new_buckets_path } = defaults;
    const new_uid = '1111';
    const account_options = { config_root, name, new_buckets_path, uid: new_uid };
    const res = await exec_manage_cli(type, action, account_options);
    const parsed_res = JSON.parse(res);
    return parsed_res;
}

async function status_account(show_secrets) {
    const action = ACTIONS.STATUS;
    const { type, name } = defaults;
    const account_options = { config_root, name, show_secrets };
    const res = await exec_manage_cli(type, action, account_options);
    const parsed_res = JSON.parse(res);
    return parsed_res;
}

async function list_account_flow() {
    const action = ACTIONS.LIST;
    const { type } = defaults;
    const account_options = { config_root };
    const res = await exec_manage_cli(type, action, account_options);
    const parsed_res = JSON.parse(res);
    return parsed_res;
}

async function delete_account_flow() {
    const action = ACTIONS.DELETE;
    const { type, name } = defaults;
    const account_options = { config_root, name };
    const res = await exec_manage_cli(type, action, account_options);
    const parsed_res = JSON.parse(res);
    return parsed_res;
}

// Jest has builtin function fail that based on Jasmine
// in case Jasmine would get removed from jest, created this one
// based on this: https://stackoverflow.com/a/55526098/16571658
function fail(reason) {
    throw new Error(reason);
}

async function setup_nc_system_and_first_account() {
    await fs_utils.create_fresh_path(root_path);
    set_nc_config_dir_in_config(config_root);
    const action = ACTIONS.ADD;
    const { type, name, new_buckets_path, uid, gid } = defaults;
    const account_options = { config_root, name, new_buckets_path, uid, gid };
    await fs_utils.create_fresh_path(new_buckets_path);
    await fs_utils.file_must_exist(new_buckets_path);
    await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
    await exec_manage_cli(type, action, account_options);
}
