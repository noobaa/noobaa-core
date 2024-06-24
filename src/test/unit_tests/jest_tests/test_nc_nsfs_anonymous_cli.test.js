/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const _ = require('lodash');
const path = require('path');
const P = require('../../../util/promise');
const os_util = require('../../../util/os_utils');
const fs_utils = require('../../../util/fs_utils');
const nb_native = require('../../../util/nb_native');
const { TMP_PATH, set_nc_config_dir_in_config } = require('../../system_tests/test_utils');
const { get_process_fs_context } = require('../../../util/native_fs_utils');
const { TYPES, ACTIONS, CONFIG_SUBDIRS } = require('../../../manage_nsfs/manage_nsfs_constants');
const ManageCLIError = require('../../../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../../../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;

const tmp_fs_path = path.join(TMP_PATH, 'test_nc_nsfs_anon_account_cli');
const DEFAULT_FS_CONFIG = get_process_fs_context();
const config = require('../../../../config');

// eslint-disable-next-line max-lines-per-function
describe('manage nsfs cli anonymous account flow', () => {
    describe('cli create anonymous account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
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
            await P.all(_.map([CONFIG_SUBDIRS.ACCOUNTS, CONFIG_SUBDIRS.ACCESS_KEYS], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
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
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, config.ANONYMOUS_ACCOUNT_NAME, true);
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
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, config.ANONYMOUS_ACCOUNT_NAME, true);
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
    });

    describe('cli update anonymous account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
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
            await P.all(_.map([CONFIG_SUBDIRS.ACCOUNTS, CONFIG_SUBDIRS.ACCESS_KEYS], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
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
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, config.ANONYMOUS_ACCOUNT_NAME, true);
            assert_account(account, account_options);

            action = ACTIONS.UPDATE;
            gid = 1001;
            const account_update_options = { anonymous, config_root, uid, gid };
            await exec_manage_cli(type, action, account_update_options);
            const update_account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, config.ANONYMOUS_ACCOUNT_NAME, true);
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
    });

    describe('cli delete anonymous account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
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
            await P.all(_.map([CONFIG_SUBDIRS.ACCOUNTS, CONFIG_SUBDIRS.ACCESS_KEYS], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
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
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, config.ANONYMOUS_ACCOUNT_NAME, true);
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
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
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
            await P.all(_.map([CONFIG_SUBDIRS.ACCOUNTS, CONFIG_SUBDIRS.ACCESS_KEYS], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
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
            const account = await read_config_file(config_root, CONFIG_SUBDIRS.ROOT_ACCOUNTS, config.ANONYMOUS_ACCOUNT_NAME, true);
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
 * read_config_file will read the config files 
 * @param {string} config_root
 * @param {string} schema_dir 
 * @param {string} config_file_name the name of the config file
 * @param {boolean} [is_symlink] a flag to set the suffix as a symlink instead of json
 */
async function read_config_file(config_root, schema_dir, config_file_name, is_symlink) {
    const config_path = path.join(config_root, schema_dir, config_file_name + (is_symlink ? '.symlink' : '.json'));
    const { data } = await nb_native().fs.readFile(DEFAULT_FS_CONFIG, config_path);
    const config_data = JSON.parse(data.toString());
    return config_data;
}

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
