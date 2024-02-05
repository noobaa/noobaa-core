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
const ManageCLIError = require('../../../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../../../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;
const { TYPES, ACTIONS } = require('../../../manage_nsfs/manage_nsfs_constants');

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


// eslint-disable-next-line max-lines-per-function
describe('manage nsfs cli account flow', () => {
    const accounts_schema_dir = 'accounts';
    const buckets_schema_dir = 'buckets';
    const access_keys_schema_dir = 'access_keys';

    describe('cli create account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
        const defaults = {
            _id: 'account1',
            type: TYPES.ACCOUNT,
            name: 'account1',
            email: 'account1@noobaa.io',
            new_buckets_path: `${root_path}new_buckets_path_user1/`,
            uid: 999,
            gid: 999,
            access_key: 'GIGiFAnjaaE7OKD5N7hA',
            secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
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
            const action = ACTIONS.ADD;
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
            const action = ACTIONS.ADD;
            const { type, access_key, name, email, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key, name, email, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.MissingAccountSecretKeyFlag.message);
        });

        it('cli create account without access_key and with secret_key', async () => {
            const action = ACTIONS.ADD;
            const { type, secret_key, name, email, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, secret_key, name, email, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.MissingAccountAccessKeyFlag.message);
        });

        it('cli create account with access_keys', async () => {
            const action = ACTIONS.ADD;
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

        it('should fail - cli update account access_key wrong complexity', async () => {
            const { type, secret_key, name, email, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key: 'abc', secret_key, name, email, new_buckets_path, uid, gid };
            const action = ACTIONS.UPDATE;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.AccountAccessKeyFlagComplexity.message);
        });

        it('should fail - cli update account secret_key wrong complexity', async () => {
            const { type, access_key, name, email, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key, secret_key: 'abc', name, email, new_buckets_path, uid, gid };
            const action = ACTIONS.UPDATE;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.AccountSecretKeyFlagComplexity.message);
        });

        it('should fail - cli create account integer uid and gid', async () => {
            const action = ACTIONS.ADD;
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

        it('should fail - cli create account invalid option', async () => {
            const { type, name, email, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, name, email, new_buckets_path, uid, gid, lala: 'lala'}; // lala invalid option
            const action = ACTIONS.ADD;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
        });

        it('should fail - cli create account invalid option type (user as boolean)', async () => {
            const { type, name, email, new_buckets_path } = defaults;
            const account_options = { config_root, name, email, new_buckets_path};
            const action = ACTIONS.ADD;
            const command = create_command(type, action, account_options);
            const flag = 'user'; // we will add user flag without value
            const res = await exec_manage_cli_add_empty_option(command, flag);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
        });

        it('should fail - cli create account invalid option type (new_buckets_path as number)', async () => {
            const action = ACTIONS.ADD;
            const { type, name, email, uid, gid } = defaults;
            const new_buckets_path_invalid = 4e34; // invalid should be string represents a path
            const account_options = { config_root, name, email, new_buckets_path: new_buckets_path_invalid, uid, gid };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
        });

        it('should fail - cli create account invalid option type (new_buckets_path as string)', async () => {
            const action = ACTIONS.ADD;
            const { type, name, email, uid, gid } = defaults;
            const new_buckets_path_invalid = 'aaa'; // invalid should be string represents a path
            const account_options = { config_root, name, email, new_buckets_path: new_buckets_path_invalid, uid, gid };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidAccountNewBucketsPath.message);
        });

        it('cli account add - uid is 0, gid is not 0', async function() {
            const account_name = 'uid_is_0';
            const options = { name: account_name, email: `${account_name}@noobaa.com`, uid: 0, gid: 1001 };
            const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...options });
            const account = JSON.parse(res).response.reply;
            assert_account(account, options, false);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_name });
        });

        it('cli account add - uid is not 0, gid is 0', async function() {
            const account_name = 'gid_is_0';
            const options = { name: account_name, email: `${account_name}@noobaa.com`, uid: 1001, gid: 0 };
            const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...options });
            const account = JSON.parse(res).response.reply;
            assert_account(account, options, false);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_name });
        });

        it('cli account add - uid is 0, gid is 0', async function() {
            const account_name = 'uid_gid_are_0';
            const options = { name: account_name, email: `${account_name}@noobaa.com`, uid: 0, gid: 0 };
            const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...options });
            const account = JSON.parse(res).response.reply;
            assert_account(account, options, false);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_name });
        });

    });

    describe('cli update account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs1');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs1/');
        const type = TYPES.ACCOUNT;
        const defaults = {
            name: 'account1',
            email: 'account1@noobaa.io',
            new_buckets_path: `${root_path}new_buckets_path_user1/`,
            uid: 999,
            gid: 999,
            access_key: 'GIGiFAnjaaE7OKD5N7hA',
            secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        };

        beforeEach(async () => {
            await P.all(_.map([accounts_schema_dir, access_keys_schema_dir], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
            await fs_utils.create_fresh_path(root_path);
            const action = ACTIONS.ADD;
            const { new_buckets_path } = defaults;
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
            const { name } = defaults;
            const account_options = { config_root, name, regenerate: true };
            const account_details = await read_config_file(config_root, accounts_schema_dir, name);
            const action = ACTIONS.UPDATE;
            await exec_manage_cli(type, action, account_options);
            let new_account_details = await read_config_file(config_root, accounts_schema_dir, name);
            expect(account_details.access_keys[0].access_key).not.toBe(new_account_details.access_keys[0].access_key);
            const new_access_key = new_account_details.access_keys[0].access_key;
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, new_access_key, true);
            //fixing the new_account_details for compare. 
            new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
            assert_account(account_symlink, new_account_details);
        });

        it('cli account update name by name', async function() {
            const { name } = defaults;
            const new_name = 'account1_new_name';
            const account_options = { config_root, name, new_name };
            const action = ACTIONS.UPDATE;
            account_options.new_name = 'account1_new_name';
            await exec_manage_cli(type, action, account_options);
            let new_account_details = await read_config_file(config_root, accounts_schema_dir, new_name);
            expect(new_account_details.name).toBe(new_name);
            const access_key = new_account_details.access_keys[0].access_key;
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            //fixing the new_account_details for compare. 
            new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
            assert_account(account_symlink, new_account_details);
        });

        it('cli account update access key, secret_key & new_name by name', async function() {
            const { name } = defaults;
            const new_name = 'account1_new_name';
            const access_key = 'GIGiFAnjaaE7OKD5N7hB';
            const secret_key = 'U3AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE';
            const account_options = { config_root, name, new_name, access_key, secret_key };
            const account_details = await read_config_file(config_root, accounts_schema_dir, name);
            const action = ACTIONS.UPDATE;
            account_options.new_name = 'account1_new_name';
            await exec_manage_cli(type, action, account_options);
            let new_account_details = await read_config_file(config_root, accounts_schema_dir, new_name);
            expect(new_account_details.name).toBe(new_name);
            expect(account_details.access_keys[0].access_key).not.toBe(new_account_details.access_keys[0].access_key);
            expect(account_details.access_keys[0].secret_key).not.toBe(new_account_details.access_keys[0].secret_key);
            expect(new_account_details.access_keys[0].access_key).toBe(access_key);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            //fixing the new_account_details for compare. 
            new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
            assert_account(account_symlink, new_account_details);
        });

        it('cli update account access_key and secret_key using flags', async () => {
            const { name } = defaults;
            const access_key = 'GIGiFAnjaaE7OKD5N7hB';
            const secret_key = 'U3AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE';
            const account_options = { config_root, name, access_key, secret_key };
            const account_details = await read_config_file(config_root, accounts_schema_dir, name);
            const action = ACTIONS.UPDATE;
            await exec_manage_cli(type, action, account_options);
            let new_account_details = await read_config_file(config_root, accounts_schema_dir, name);
            expect(account_details.access_keys[0].access_key).not.toBe(new_account_details.access_keys[0].access_key);
            expect(account_details.access_keys[0].secret_key).not.toBe(new_account_details.access_keys[0].secret_key);
            expect(new_account_details.access_keys[0].access_key).toBe(access_key);
            const account_symlink = await read_config_file(config_root, access_keys_schema_dir, access_key, true);
            //fixing the new_account_details for compare. 
            new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
            assert_account(account_symlink, new_account_details);
        });

        it('should fail - cli update account invalid option', async () => {
            const { name } = defaults;
            const account_options = { config_root, name, lala: 'lala'}; // lala invalid option
            const action = ACTIONS.UPDATE;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
        });

        it('should fail - cli update account invalid option type', async () => {
            const { name } = defaults;
            const account_options = { config_root, name};
            const action = ACTIONS.UPDATE;
            const command = create_command(type, action, account_options);
            const flag = 'user'; // we will add user flag without value
            const res = await exec_manage_cli_add_empty_option(command, flag);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
        });

    });

    describe('cli list account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs1');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs1/');
        const type = TYPES.ACCOUNT;
        const defaults = [{
            name: 'account1',
            email: 'account1@noobaa.io',
            new_buckets_path: `${root_path}new_buckets_path_user1/`,
            uid: 999,
            gid: 999,
            access_key: 'GIGiFAnjaaE7OKD5N7hA',
            secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        }, {
            name: 'account2',
            email: 'account2@noobaa.io',
            new_buckets_path: `${root_path}new_buckets_path_user2/`,
            uid: 888,
            gid: 888,
            access_key: 'BIBiFAnjaaE7OKD5N7hA',
            secret_key: 'BIBYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        }, {
            name: 'account3',
            email: 'account3@noobaa.io',
            new_buckets_path: `${root_path}new_buckets_path_user2/`,
            uid: 999,
            gid: 888,
            access_key: 'TIBiFAnjaaE7OKD5N7hA',
            secret_key: 'BITYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
            },
        {
            name: 'account4',
            email: 'account4@noobaa.io',
            new_buckets_path: `${root_path}new_buckets_path_user2/`,
            user: 'root',
            access_key: 'DIBiFAnjaaE7OKD5N7hA',
            secret_key: 'BITYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        }];

        beforeAll(async () => {
            await P.all(_.map([accounts_schema_dir, access_keys_schema_dir], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
            await fs_utils.create_fresh_path(root_path);
            // Creating the account
            const action = ACTIONS.ADD;
            for (const account_defaults of Object.values(defaults)) {
                let account_options = { config_root };
                account_options = { ...account_options, ...account_defaults };
                await fs_utils.create_fresh_path(account_options.new_buckets_path);
                await fs_utils.file_must_exist(account_options.new_buckets_path);
                await exec_manage_cli(type, action, account_options);
            }
        });

        afterAll(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli list', async () => {
            const account_options = { config_root };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account2', 'account1']));
        });

        it('cli list wide', async () => {
            const account_options = { config_root, wide: true };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account2', 'account1']));
        });

        it('cli list filter by UID', async () => {
            const account_options = { config_root, uid: 999 };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account1']));
        });

        it('cli list filter by GID', async () => {
            const account_options = { config_root, gid: 999 };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account1']));
        });

        it('cli list filter by UID and GID (account 1)', async () => {
            const account_options = { config_root, uid: 999, gid: 999 };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account1']));
        });

        it('cli list filter by UID and GID (account 3)', async () => {
            const account_options = { config_root, uid: 999, gid: 888 };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3']));
        });

        it('should fail - cli list account invalid option', async () => {
            const account_options = { config_root, lala: 'lala'}; // lala invalid option
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
        });

        it('cli list filter by user (account 4)', async () => {
            const account_options = { config_root, user: 'root' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account4']));
        });

        it('cli list filter by user (none)', async () => {
            const account_options = { config_root, user: 'shaul' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual([]);
        });

        it('cli list filter by access key (account1)', async () => {
            const account_options = { config_root, access_key: 'GIGiFAnjaaE7OKD5N7hA' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account1']));
        });

        it('cli list filter by name (account3)', async () => {
            const account_options = { config_root, name: 'account3' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3']));
        });

        it('cli list filter by access key (of account1) and name (of account3) - (none)', async () => {
            const account_options = { config_root, name: 'account3', access_key: 'GIGiFAnjaaE7OKD5N7hA' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual([]);
        });

        it('cli account status without name and access_key', async function() {
            const action = ACTIONS.STATUS;
                const res = await exec_manage_cli(TYPES.ACCOUNT, action, { config_root });
                expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.MissingIdentifier.code);
        });

    });

    describe('cli delete account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
        const defaults = {
            type: TYPES.ACCOUNT,
            name: 'account11',
            email: 'account11@noobaa.io',
            new_buckets_path: `${root_path}new_buckets_path_user11/`,
            uid: 1011,
            gid: 1011,
            access_key: 'GIGiFAnjaaE7OKD5N7h1',
            secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+31EXAMPLE',
        };

        beforeEach(async () => {
            await P.all(_.map([accounts_schema_dir, access_keys_schema_dir, buckets_schema_dir], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
            await fs_utils.create_fresh_path(root_path);
        });

        beforeEach(async () => {
            // cli create account
            const action = ACTIONS.ADD;
            const { type, name, email, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, name, email, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await exec_manage_cli(type, action, account_options);
            const config_path = path.join(config_root, accounts_schema_dir, name + '.json');
            await fs_utils.file_must_exist(config_path);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli delete account (account that does not own any bucket)', async () => {
            // cli create account - happens in the "beforeEach"

            // cli delete account
            const action = ACTIONS.DELETE;
            const { type, name } = defaults;
            const account_options = { config_root, name };
            const res = await exec_manage_cli(type, action, account_options);
            const res_json = JSON.parse(res.trim());
            expect(res_json.response.code).toBe(ManageCLIResponse.AccountDeleted.code);
            const config_path = path.join(config_root, accounts_schema_dir, name + '.json');
            await fs_utils.file_must_not_exist(config_path);
        });

        it('cli delete account - should fail, account owns a bucket', async () => {
            // cli create account - happens in the "beforeEach"

            // cli create bucket
            let type = TYPES.BUCKET;
            const bucket_name = 'bucket111';
            let action = ACTIONS.ADD;
            const { email, new_buckets_path } = defaults;
            const bucket_options = { config_root, path: new_buckets_path, name: bucket_name, email: email};
            await exec_manage_cli(type, action, bucket_options);
            let config_path = path.join(config_root, buckets_schema_dir, bucket_name + '.json');
            await fs_utils.file_must_exist(config_path);

            // cli delete account
            type = TYPES.ACCOUNT;
            action = ACTIONS.DELETE;
            const { name } = defaults;
            const account_options = { config_root, name };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.AccountDeleteForbiddenHasBuckets.code);
            config_path = path.join(config_root, accounts_schema_dir, name + '.json');
            await fs_utils.file_must_exist(config_path);
        });

        it('should fail - cli delete account invalid option', async () => {
            const action = ACTIONS.DELETE;
            const { type, name } = defaults;
            const account_options = { config_root, name, lala: 'lala'}; // lala invalid option };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
        });

    });

    describe('cli status account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs22');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs22/');
        const type = TYPES.ACCOUNT;
        const defaults = {
            name: 'account22',
            email: 'account22@noobaa.io',
            new_buckets_path: `${root_path}new_buckets_path_user22/`,
            uid: 1022,
            gid: 1022,
            access_key: 'GIGiFAnjaaE7OKD5N722',
            secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+22EXAMPLE',
        };

        beforeEach(async () => {
            await P.all(_.map([accounts_schema_dir, access_keys_schema_dir], async dir =>
                fs_utils.create_fresh_path(`${config_root}/${dir}`)));
            await fs_utils.create_fresh_path(root_path);
            const action = ACTIONS.ADD;
            const { new_buckets_path } = defaults;
            const account_options = { config_root, ...defaults };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await exec_manage_cli(type, action, account_options);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli account status without name and access_key', async function() {
            const action = ACTIONS.STATUS;
            const res = await exec_manage_cli(type, action, { config_root });
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.MissingIdentifier.code);
        });

        it('should fail - cli status account invalid option', async () => {
            const action = ACTIONS.STATUS;
            const { name } = defaults;
            const account_options = { config_root, name, lala: 'lala'}; // lala invalid option };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
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
 * exec_manage_cli_add_empty_flag adds a flag with no value
 * @param {string} command
 * @param {string} option
 */
async function exec_manage_cli_add_empty_option(command, option) {
    const changed_command = command + ` --${option}`;
    let res;
    try {
        res = await os_util.exec(changed_command, { return_stdout: true });
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
