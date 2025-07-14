/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const path = require('path');
const os_util = require('../../../../util/os_utils');
const fs_utils = require('../../../../util/fs_utils');
const { ConfigFS } = require('../../../../sdk/config_fs');
const { TMP_PATH, set_nc_config_dir_in_config } = require('../../../system_tests/test_utils');
const { TYPES, ACTIONS } = require('../../../../manage_nsfs/manage_nsfs_constants');
const ManageCLIError = require('../../../../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../../../../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;

const tmp_fs_path = path.join(TMP_PATH, 'test_nc_nsfs_anon_account_cli');
const config = require('../../../../../config');

const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
const config_fs = new ConfigFS(config_root);
const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');

// eslint-disable-next-line max-lines-per-function
describe('manage nsfs cli anonymous account flow', () => {
    describe('cli create anonymous account', () => {
        const defaults = {
            _id: 'account1',
            type: TYPES.ACCOUNT,
            name: config.ANONYMOUS_ACCOUNT_NAME,
            user: 'root',
            anonymous: true,
            uid: 999,
            gid: 999,
        };
        beforeAll(async () => {
            await fs_utils.create_fresh_path(root_path);
            set_nc_config_dir_in_config(config_root);
            config.NSFS_NC_CONF_DIR = config_root;
        });

        beforeAll(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli create anonymous account', async () => {
            const action = ACTIONS.ADD;
            const { type, uid, gid, anonymous } = defaults;
            const account_options = { anonymous, config_root, uid, gid };
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(config.ANONYMOUS_ACCOUNT_NAME);
            assert_account(account, account_options);
        });

        it('Should fail - cli create anonymous account again', async () => {
            const action = ACTIONS.ADD;
            const { type, uid, gid, anonymous } = defaults;
            const account_options = { anonymous, config_root, uid, gid };
            const resp = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.AccountNameAlreadyExists.message);
        });

        it('Should fail - cli create anonymous account with invalid action', async () => {
            const { type, uid, gid } = defaults;
            const account_options = { config_root, uid, gid };
            const resp = await exec_manage_cli(type, 'reload', account_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.InvalidAction.message);
        });

        it('Should fail - cli create anonymous account with name(not a valid argument)', async () => {
            const action = ACTIONS.ADD;
            const { type, name, uid, gid, anonymous } = defaults;
            const account_options = { anonymous, config_root, uid, gid, name };
            const resp = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
        });

        it('Should fail - cli create anonymous account with invalid type', async () => {
            const action = ACTIONS.ADD;
            const { uid, gid, anonymous } = defaults;
            const account_options = { anonymous, config_root, uid, gid };
            const resp = await exec_manage_cli('account_anonymous', action, account_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.InvalidType.message);
        });

        it('Should fail - cli create anonymous account with invalid uid', async () => {
            const action = ACTIONS.ADD;
            const { type, gid, anonymous } = defaults;
            const uid_str = '0';
            const account_options = { anonymous, config_root, uid_str, gid };
            const resp = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
        });

        it('Should fail - cli create anonymous account with invalid gid', async () => {
            const action = ACTIONS.ADD;
            const { type, uid, anonymous } = defaults;
            const gid_str = '0';
            const account_options = { anonymous, config_root, uid, gid_str };
            const resp = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
        });

        it('cli create anonymous account with distinguished_name', async () => {
            let action = ACTIONS.DELETE;
            const { type, user, anonymous } = defaults;
            let account_options = { anonymous, config_root };
            let resp = await exec_manage_cli(type, action, account_options);
            const res_json = JSON.parse(resp.trim());
            expect(res_json.response.code).toBe(ManageCLIResponse.AccountDeleted.code);
            action = ACTIONS.ADD;
            account_options = { anonymous, config_root, user };
            resp = await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(config.ANONYMOUS_ACCOUNT_NAME);
            assert_account(account, account_options);
        });

        it('Should fail - cli create anonymous account with invalid user', async () => {
            const action = ACTIONS.ADD;
            const { type, anonymous } = defaults;
            const user_int = 0;
            const account_options = { anonymous, config_root, user_int };
            const resp = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
        });

        it('cli create anonymous account with supplemental_groups - string', async () => {
            //first delete the existing anonymous account
            let action = ACTIONS.DELETE;
            const { type, anonymous, uid, gid } = defaults;
            let account_options = { anonymous, config_root };
            const resp = await exec_manage_cli(type, action, account_options);
            const res_json = JSON.parse(resp.trim());
            expect(res_json.response.code).toBe(ManageCLIResponse.AccountDeleted.code);

            action = ACTIONS.ADD;
            const supplemental_groups = '0,202,101';
            const expected_groups = [0, 202, 101];
            account_options = { anonymous, config_root, uid, gid, supplemental_groups };
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(config.ANONYMOUS_ACCOUNT_NAME);
            expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);
        });

        it('cli create anonymous account with supplemental_groups - number', async () => {
            let action = ACTIONS.DELETE;
            const { type, anonymous, uid, gid } = defaults;
            let account_options = { anonymous, config_root };
            const resp = await exec_manage_cli(type, action, account_options);
            const res_json = JSON.parse(resp.trim());
            expect(res_json.response.code).toBe(ManageCLIResponse.AccountDeleted.code);

            action = ACTIONS.ADD;
            const supplemental_groups = 0;
            const expected_groups = [0];
            account_options = { anonymous, config_root, uid, gid, supplemental_groups };
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(config.ANONYMOUS_ACCOUNT_NAME);
            expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);
        });

        it('should fail - cli create anonymous account with invalid supplemental_groups - not a number', async () => {
            const action = ACTIONS.ADD;
            const { type, uid, gid, anonymous } = defaults;
            const supplemental_groups = '303g,202,101';
            const account_options = { anonymous, config_root, uid, gid, supplemental_groups };
            const resp = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.InvalidSupplementalGroupsList.message);
        });

        it('should fail - cli create anonymous account with invalid supplemental_groups - negative number', async () => {
            const action = ACTIONS.ADD;
            const { type, uid, gid, anonymous } = defaults;
            const supplemental_groups = '0,-202,101';
            const account_options = { anonymous, config_root, uid, gid, supplemental_groups };
            const resp = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.InvalidSupplementalGroupsList.message);
        });
    });

    describe('cli update anonymous account', () => {
        const defaults = {
            _id: 'account2',
            type: TYPES.ACCOUNT,
            name: config.ANONYMOUS_ACCOUNT_NAME,
            user: 'root',
            anonymous: true,
            uid: 999,
            gid: 999,
        };
        beforeAll(async () => {
            await fs_utils.create_fresh_path(root_path);
            set_nc_config_dir_in_config(config_root);
            config.NSFS_NC_CONF_DIR = config_root;
        });

        beforeAll(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli update anonymous account', async () => {
            let action = ACTIONS.ADD;
            let { type, uid, gid, anonymous } = defaults;
            const account_options = { anonymous, config_root, uid, gid };
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(config.ANONYMOUS_ACCOUNT_NAME);
            assert_account(account, account_options);

            action = ACTIONS.UPDATE;
            gid = 1001;
            const account_update_options = { anonymous, config_root, uid, gid };
            await exec_manage_cli(type, action, account_update_options);
            const update_account = await config_fs.get_account_by_name(config.ANONYMOUS_ACCOUNT_NAME);
            assert_account(update_account, account_update_options);
        });

        it('should fail - cli update anonymous account with string gid', async () => {
            const action = ACTIONS.UPDATE;
            const { type, uid, anonymous } = defaults;
            const gid = 'str';
            const account_update_options = { anonymous, config_root, uid, gid };
            const resp = await exec_manage_cli(type, action, account_update_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
        });

        it('should fail - cli update anonymous account with invalid user', async () => {
            const action = ACTIONS.UPDATE;
            const { type, anonymous } = defaults;
            const user = 0;
            const account_update_options = { anonymous, config_root, user };
            const resp = await exec_manage_cli(type, action, account_update_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
        });

        it('cli update anonymous account with supplemental_groups - string', async () => {
            const action = ACTIONS.UPDATE;
            const { type, uid, gid, anonymous } = defaults;
            const supplemental_groups = '0,202,101';
            const expected_groups = [0, 202, 101];
            const account_update_options = { anonymous, config_root, uid, gid, supplemental_groups };
            await exec_manage_cli(type, action, account_update_options);
            const account = await config_fs.get_account_by_name(config.ANONYMOUS_ACCOUNT_NAME);
            expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);
        });

        it('cli update anonymous account with supplemental_groups - number', async () => {
            const action = ACTIONS.UPDATE;
            const { type, uid, gid, anonymous } = defaults;
            const supplemental_groups = 0;
            const expected_groups = [0];
            const account_update_options = { anonymous, config_root, uid, gid, supplemental_groups };
            await exec_manage_cli(type, action, account_update_options);
            const account = await config_fs.get_account_by_name(config.ANONYMOUS_ACCOUNT_NAME);
            expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);
        });
    });

    describe('cli delete anonymous account', () => {
        const defaults = {
            _id: 'account2',
            type: TYPES.ACCOUNT,
            name: config.ANONYMOUS_ACCOUNT_NAME,
            user: 'root',
            anonymous: true,
            uid: 999,
            gid: 999,
        };
        beforeAll(async () => {
            await fs_utils.create_fresh_path(root_path);
            set_nc_config_dir_in_config(config_root);
            config.NSFS_NC_CONF_DIR = config_root;
        });

        beforeAll(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli delete anonymous account', async () => {
            let action = ACTIONS.ADD;
            const { type, uid, gid, anonymous } = defaults;
            const account_options = { anonymous, config_root, uid, gid };
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(config.ANONYMOUS_ACCOUNT_NAME);
            assert_account(account, account_options);

            action = ACTIONS.DELETE;
            const account_delete_options = { anonymous, config_root };
            const resp = await exec_manage_cli(type, action, account_delete_options);
            const res_json = JSON.parse(resp.trim());
            expect(res_json.response.code).toBe(ManageCLIResponse.AccountDeleted.code);
        });

        it('should fail - Anonymous account try to delete again ', async () => {
            const action = ACTIONS.DELETE;
            const { type, anonymous } = defaults;
            const account_delete_options = { anonymous, config_root };
            const resp = await exec_manage_cli(type, action, account_delete_options);
            expect(JSON.parse(resp.stdout).error.message).toBe(ManageCLIError.NoSuchAccountName.message);
        });
    });

    describe('cli status anonymous account', () => {
        const defaults = {
            _id: 'account4',
            type: TYPES.ACCOUNT,
            name: config.ANONYMOUS_ACCOUNT_NAME,
            user: 'root',
            anonymous: true,
            uid: 999,
            gid: 999,
        };
        beforeAll(async () => {
            await fs_utils.create_fresh_path(root_path);
            set_nc_config_dir_in_config(config_root);
            config.NSFS_NC_CONF_DIR = config_root;
        });

        beforeAll(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli status anonymous account', async () => {
            let action = ACTIONS.ADD;
            const { type, uid, gid, anonymous } = defaults;
            const account_options = { anonymous, config_root, uid, gid };
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(config.ANONYMOUS_ACCOUNT_NAME);
            assert_account(account, account_options);

            action = ACTIONS.STATUS;
            const account_delete_options = { anonymous, config_root };
            const resp = await exec_manage_cli(type, action, account_delete_options);
            const res_json = JSON.parse(resp.trim());
            assert_account(res_json.response.reply, account_options);
        });
    });

});

/**
 * assert_account will verify the fields of the accounts 
 * @param {object} account
 * @param {object} account_options
 */
function assert_account(account, account_options) {
    expect(account.name).toEqual(config.ANONYMOUS_ACCOUNT_NAME);

    if (account_options.distinguished_name) {
        expect(account.nsfs_account_config.distinguished_name).toEqual(account_options.distinguished_name);
    } else {
        expect(account.nsfs_account_config.uid).toEqual(account_options.uid);
        expect(account.nsfs_account_config.gid).toEqual(account_options.gid);
    }
}

/**
 * exec_manage_cli will get the flags for the cli and runs the cli with it's flags
 * @param {string} type
 * @param {string} action
 * @param {object} options
 */
async function exec_manage_cli(type, action, options) {
    const command = create_command(type, action, options);
    let res;
    try {
        res = await os_util.exec(command, { return_stdout: true });
    } catch (e) {
        res = e;
    }
    return res;
}

/** 
 * create_command would create the string needed to run the CLI command
 * @param {string} type
 * @param {string} action
 * @param {object} options
 */
function create_command(type, action, options) {
    let account_flags = ``;
    for (const key in options) {
        if (Object.hasOwn(options, key)) {
            if (typeof options[key] === 'boolean') {
                account_flags += `--${key} `;
            } else {
                account_flags += `--${key} ${options[key]} `;
            }
        }
    }
    account_flags = account_flags.trim();

    const command = `node src/cmd/manage_nsfs ${type} ${action} ${account_flags}`;
    return command;
}
