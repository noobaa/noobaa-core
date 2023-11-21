/* Copyright (C) 2016 NooBaa */
/* eslint-disable no-undef */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const _ = require('lodash');
const path = require('path');
const P = require('../../../util/promise');
const fs_utils = require('../../../util/fs_utils');
const os_util = require('../../../util/os_utils');
const nb_native = require('../../../util/nb_native');

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

const nc_nsfs_manage_actions = {
    ADD: 'add',
    UPDATE: 'update',
    DELETE: 'delete'
};

describe('manage nsfs cli account flow', () => {
    const accounts_schema_dir = 'accounts';
    const access_keys_schema_dir = 'access_keys';

    describe('cli create account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
        const defaults = {
            type: 'account',
            name: 'account1',
            email: 'account1@noobaa.io',
            new_buckets_path: `${root_path}new_buckets_path_user1/`,
            uid: 999,
            gid: 999,
            access_key: 'abc',
            secret_key: '123',
        };

        beforeEach(async () => {
            await P.all(_.map([accounts_schema_dir, access_keys_schema_dir], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
            await fs_utils.create_fresh_path(root_path);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli create account without access_keys', async () => {
            const action = nc_nsfs_manage_actions.ADD;
            const { type, name, email, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, name, email, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await exec_manage_cli(type, action, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            assert_account(account, account_options, false);
            const access_key = account.access_keys[0].access_key;
            const secret_key = account.access_keys[0].secret_key;
            expect(access_key).toBeDefined();
            expect(secret_key).toBeDefined();
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
        });

        it('cli create account with access_key and without secret_key', async () => {
            const action = nc_nsfs_manage_actions.ADD;
            const { type, access_key, name, email, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key, name, email, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await exec_manage_cli(type, action, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            const account_access_key = account.access_keys[0].access_key;
            const secret_key = account.access_keys[0].secret_key;
            expect(access_key).toEqual(account_access_key);
            expect(secret_key).toBeDefined();
            assert_account(account, account_options, false);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
        });

        it('cli create account without access_key and with secret_key', async () => {
            const action = nc_nsfs_manage_actions.ADD;
            const { type, secret_key, name, email, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, secret_key, name, email, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await exec_manage_cli(type, action, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            const access_key = account.access_keys[0].access_key;
            const account_secret_key = account.access_keys[0].secret_key;
            expect(access_key).toBeDefined();
            expect(secret_key).toEqual(account_secret_key);
            assert_account(account, account_options, false);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
        });

        it('cli create account with access_keys', async () => {
            const action = nc_nsfs_manage_actions.ADD;
            const { type, access_key, secret_key, name, email, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key, secret_key, name, email, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await exec_manage_cli(type, action, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            assert_account(account, account_options, true);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
        });

        it('should fail - cli create account string uid', async () => {
            const action = nc_nsfs_manage_actions.ADD;
            const { type, access_key, secret_key, name, email, new_buckets_path, gid } = defaults;
            const account_options = { config_root, access_key, secret_key, name, email, new_buckets_path, uid: 'uid', gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await expect(exec_manage_cli(type, action, account_options)).resolves.toMatch(/UID must be a number/);
        });

        it('should fail - cli create account string gid', async () => {
            const action = nc_nsfs_manage_actions.ADD;
            const { type, access_key, secret_key, name, email, new_buckets_path, uid } = defaults;
            const account_options = { config_root, access_key, secret_key, name, email, new_buckets_path, uid, gid: 'gid' };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await expect(exec_manage_cli(type, action, account_options)).resolves.toMatch(/GID must be a number/);
        });

        it('should fail - cli create account integer uid and gid', async () => {
            const action = nc_nsfs_manage_actions.ADD;
            const { type, access_key, secret_key, name, email, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key, secret_key, name, email, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await exec_manage_cli(type, action, account_options);
            const account = await read_config_file(config_root, accounts_schema_dir, name);
            assert_account(account, account_options, false);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            assert_account(account_symlink, account_options);
        });

    });

    describe('cli update account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs1');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs1/');
        const defaults = {
            type: 'account',
            name: 'account1',
            email: 'account1@noobaa.io',
            new_buckets_path: `${root_path}new_buckets_path_user1/`,
            uid: 999,
            gid: 999,
            access_key: 'abc',
            secret_key: '123',
        };

        beforeEach(async () => {
            await P.all(_.map([accounts_schema_dir, access_keys_schema_dir], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
            await fs_utils.create_fresh_path(root_path);
            // Creating the account
            const action = nc_nsfs_manage_actions.ADD;
            const { type, new_buckets_path } = defaults;
            const account_options = { config_root, ...defaults };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await exec_manage_cli(type, action, account_options);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli regenerate account access_keys', async () => {
            const { type, name } = defaults;
            const account_options = { config_root, name, regenerate: true };
            const account_details = await read_config_file(config_root, accounts_schema_dir, name);
            const action = nc_nsfs_manage_actions.UPDATE;
            await exec_manage_cli(type, action, account_options);
            let new_account_details = await read_config_file(config_root, accounts_schema_dir, name);
            expect(account_details.access_keys[0].access_key).not.toBe(new_account_details.access_keys[0].access_key);
            const new_access_key = new_account_details.access_keys[0].access_key;
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, new_access_key, true);
            //fixing the new_account_details for compare. 
            new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
            assert_account(account_symlink, new_account_details);
        });

        it('cli update account access_key', async () => {
            const { type, name } = defaults;
            const new_access_key = 'new';
            const account_options = { config_root, name, new_access_key: new_access_key };
            const account_details = await read_config_file(config_root, accounts_schema_dir, name);
            const action = nc_nsfs_manage_actions.UPDATE;
            await exec_manage_cli(type, action, account_options);
            let new_account_details = await read_config_file(config_root, accounts_schema_dir, name);
            expect(account_details.access_keys[0].access_key).not.toBe(new_account_details.access_keys[0].access_key);
            expect(new_account_details.access_keys[0].access_key).toBe(new_access_key);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, new_access_key, true);
            //fixing the new_account_details for compare. 
            new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
            assert_account(account_symlink, new_account_details);
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
    const config = JSON.parse(data.toString());
    return config;
}

/**
 * assert_account will verify the fields of the accounts 
 * @param {object} account
 * @param {object} account_options
 * @param {boolean} [verify_access_keys] a flag to skip verifying the access_keys 
 */
function assert_account(account, account_options, verify_access_keys) {
    if (verify_access_keys) {
        expect(account.access_keys[0].access_key).toEqual(account_options.access_key);
        expect(account.access_keys[0].secret_key).toEqual(account_options.secret_key);
    }
    expect(account.email).toEqual(account_options.email);
    expect(account.name).toEqual(account_options.name);

    if (account_options.distinguished_name) {
        expect(account.nsfs_account_config.distinguished_name).toEqual(account_options.distinguished_name);
    } else {
        expect(account.nsfs_account_config.uid).toEqual(account_options.uid);
        expect(account.nsfs_account_config.gid).toEqual(account_options.gid);
    }

    expect(account.nsfs_account_config.new_buckets_path).toEqual(account_options.new_buckets_path);
}

/**
 * exec_manage_cli will get the flags for the cli and runs the cli with it's flags
 * @param {string} type
 * @param {string} action
 * @param {object} options
 */
async function exec_manage_cli(type, action, options) {
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

    const res = await os_util.exec(command, { return_stdout: true, return_stderr: true });
    return res;
}
