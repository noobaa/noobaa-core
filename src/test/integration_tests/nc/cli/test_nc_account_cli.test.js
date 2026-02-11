/* Copyright (C) 2016 NooBaa */
/* eslint-disable max-lines-per-function */
/* eslint max-lines: ['error', 4000] */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const fs = require('fs');
const _ = require('lodash');
const path = require('path');
const os_util = require('../../../../util/os_utils');
const fs_utils = require('../../../../util/fs_utils');
const { ConfigFS } = require('../../../../sdk/config_fs');
const { set_path_permissions_and_owner, create_fs_user_by_platform, CLI_UNSET_EMPTY_STRING,
    delete_fs_user_by_platform, TMP_PATH, set_nc_config_dir_in_config } = require('../../../system_tests/test_utils');
const { TYPES, ACTIONS, ANONYMOUS } = require('../../../../manage_nsfs/manage_nsfs_constants');
const ManageCLIError = require('../../../../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const ManageCLIResponse = require('../../../../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;

const tmp_fs_path = path.join(TMP_PATH, 'test_nc_account_cli');
const timeout = 60000;
const config = require('../../../../../config');
const config_fs_account_options = { show_secrets: true, decrypt_secret_key: true };

const quoted_type = Object.freeze({
    SPACE_ONLY: "s", // space only
    QUOTE_SPACE: "qs", // quote then space
    SPACE_QUOTE: "sq", // space then quote
});

// eslint-disable-next-line max-lines-per-function
describe('manage nsfs cli account flow', () => {
    /* eslint-disable max-statements */
    describe('cli create account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs');
        const config_fs = new ConfigFS(config_root);
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs/');
        const defaults = {
            _id: 'account1',
            type: TYPES.ACCOUNT,
            name: 'account1',
            new_buckets_path: `${root_path}new_buckets_path_user10/`,
            uid: 999,
            gid: 999,
            access_key: 'GIGiFAnjaaE7OKD5N7hA',
            secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        };
        beforeEach(async () => {
            await fs_utils.create_fresh_path(root_path);
            set_nc_config_dir_in_config(config_root);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli create account without access_keys', async () => {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, name, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
            const access_key = account.access_keys[0].access_key;
            const secret_key = account.access_keys[0].secret_key;
            expect(access_key).toBeDefined();
            expect(secret_key).toBeDefined();
            const account_symlink = await config_fs.get_account_by_access_key(access_key, config_fs_account_options);
            assert_account(account_symlink, account_options);
        });

        it('cli create account with access_key and without secret_key', async () => {
            const action = ACTIONS.ADD;
            const { type, access_key, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key, name, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.MissingAccountSecretKeyFlag.message);
        });

        it('cli create account without access_key and with secret_key', async () => {
            const action = ACTIONS.ADD;
            const { type, secret_key, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, secret_key, name, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.MissingAccountAccessKeyFlag.message);
        });

        it('cli create account with access_keys', async () => {
            const action = ACTIONS.ADD;
            const { type, access_key, secret_key, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key, secret_key, name, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, true);
            const account_symlink = await config_fs.get_account_by_access_key(access_key, config_fs_account_options);
            assert_account(account_symlink, account_options);
        });

        it('should fail - cli create account invalid new_buckets_path (leading space in new_buckets_path)', async () => {
            const { type, name, uid, gid, new_buckets_path } = defaults;
            const account_options = { config_root, name, uid, gid}; // will add new_buckets_path with leading space later
            const action = ACTIONS.ADD;
            const command = create_command(type, action, account_options);
            const res = await exec_manage_cli_add_leading_space_option(command, 'new_buckets_path', new_buckets_path, quoted_type.SPACE_ONLY);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create account invalid new_buckets_path (leading space in quoted new_buckets_path)', async () => {
            const { type, name, uid, gid, new_buckets_path } = defaults;
            const account_options = { config_root, name, uid, gid}; // will add quoted new_buckets_path with leading space later
            const action = ACTIONS.ADD;
            const command = create_command(type, action, account_options);
            const res = await exec_manage_cli_add_leading_space_option(command, 'new_buckets_path', new_buckets_path, quoted_type.SPACE_QUOTE);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create account invalid new_buckets_path (quoted leading space in new_buckets_path)', async () => {
            const { type, name, uid, gid, new_buckets_path } = defaults;
            const account_options = { config_root, name, uid, gid}; // will add new_buckets_path with quoted leading space later
            const action = ACTIONS.ADD;
            const command = create_command(type, action, account_options);
            const res = await exec_manage_cli_add_leading_space_option(command, 'new_buckets_path', new_buckets_path, quoted_type.QUOTE_SPACE);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountNewBucketsPath.code); // should get this error if space is also quoted with the value
        });

        it('should fail - cli update account invalid access_key - invalid size', async () => {
            const { type, secret_key, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key: 'abc', secret_key, name, new_buckets_path, uid, gid };
            const action = ACTIONS.UPDATE;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidAccountAccessKeyFlag.message);
        });

        it('should fail - cli update account invalid access_key - contains "+" ', async () => {
            const { type, secret_key, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key: 'abc+abc+abc+abc+abc+', secret_key, name, new_buckets_path, uid, gid };
            const action = ACTIONS.UPDATE;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidAccountAccessKeyFlag.message);
        });

        it('should fail - cli update account invalid secret_key - invalid size', async () => {
            const { type, access_key, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key, secret_key: 'abc', name, new_buckets_path, uid, gid };
            const action = ACTIONS.UPDATE;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidAccountSecretKeyFlag.message);
        });

        it('should fail - cli update account invalid secret_key - contains @', async () => {
            const { type, access_key, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key, secret_key: 'abcaabcabcabc@abcabcabc@abcabcabc@abcabc', name, new_buckets_path, uid, gid };
            const action = ACTIONS.UPDATE;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidAccountSecretKeyFlag.message);
        });

        it('should fail - cli create account integer uid and gid', async () => {
            const action = ACTIONS.ADD;
            const { type, access_key, secret_key, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key, secret_key, name, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
            const account_symlink = await config_fs.get_account_by_access_key(access_key, config_fs_account_options);
            assert_account(account_symlink, account_options);
        });

        it('should fail - cli create account invalid option', async () => {
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, name, new_buckets_path, uid, gid, lala: 'lala'}; // lala invalid option
            const action = ACTIONS.ADD;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
        });

        it('should fail - cli create account invalid option type (user as boolean)', async () => {
            const { type, name, new_buckets_path } = defaults;
            const account_options = { config_root, name, new_buckets_path};
            const action = ACTIONS.ADD;
            const command = create_command(type, action, account_options);
            const flag = 'user'; // we will add user flag without value
            const res = await exec_manage_cli_add_empty_option(command, flag);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
        });

        it('should fail - cli create account invalid option type (user as number)', async () => {
            const { type, name, new_buckets_path } = defaults;
            const account_options = { config_root, name, new_buckets_path, user: 0};
            const action = ACTIONS.ADD;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
        });

        it('should fail - cli create account invalid option type (path as boolean) use = in command as a flag separator', async () => {
            const { type, name } = defaults;
            const action = ACTIONS.ADD;
            const command = `node src/cmd/manage_nsfs ${type} ${action} --config_root=${config_root} --name=${name} --new_buckets_path`;
            let res;
            try {
                res = await os_util.exec(command, { return_stdout: true });
            } catch (e) {
                res = e;
            }
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
        });

        it('should fail - cli create account invalid option type (name as boolean)', async () => {
            const { type, new_buckets_path } = defaults;
            const account_options = { config_root, new_buckets_path};
            const action = ACTIONS.ADD;
            const command = create_command(type, action, account_options);
            const flag = 'name'; // we will add name flag without value
            const res = await exec_manage_cli_add_empty_option(command, flag);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
        });

        it('should fail - cli create account invalid option type (new_buckets_path as number)', async () => {
            const action = ACTIONS.ADD;
            const { type, name, uid, gid } = defaults;
            const new_buckets_path_invalid = 4e34; // invalid should be string represents a path
            const account_options = { config_root, name, new_buckets_path: new_buckets_path_invalid, uid, gid };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
        });

        it('should fail - cli create account invalid option type (new_buckets_path as string)', async () => {
            const action = ACTIONS.ADD;
            const { type, name, uid, gid } = defaults;
            const new_buckets_path_invalid = 'aaa'; // invalid should be string represents a path
            const account_options = { config_root, name, new_buckets_path: new_buckets_path_invalid, uid, gid };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidAccountNewBucketsPath.message);
        });

        it('cli account add - name is a number', async function() {
            const account_name = '0';
            const options = { name: account_name, uid: 2001, gid: 2001 };
            const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...options });
            const account = JSON.parse(res).response.reply;
            assert_account(account, options, false);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_name });
        });


        it('cli account add - uid is 0, gid is not 0', async function() {
            const account_name = 'uid_is_0';
            const options = { name: account_name, uid: 0, gid: 1001 };
            const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...options });
            const account = JSON.parse(res).response.reply;
            assert_account(account, options, false);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_name });
        });

        it('cli account add - uid is not 0, gid is 0', async function() {
            const account_name = 'gid_is_0';
            const options = { name: account_name, uid: 1001, gid: 0 };
            const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...options });
            const account = JSON.parse(res).response.reply;
            assert_account(account, options, false);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_name });
        });

        it('cli account add - uid is 0, gid is 0', async function() {
            const account_name = 'uid_gid_are_0';
            const options = { name: account_name, uid: 0, gid: 0 };
            const res = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...options });
            const account = JSON.parse(res).response.reply;
            assert_account(account, options, false);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_name });
        });

        it('cli account add - use explicit flag allow_bucket_creation true', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const allow_bucket_creation = 'true';
            const account_options = { config_root, name, new_buckets_path, uid, gid, allow_bucket_creation };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
            expect(account.allow_bucket_creation).toBe(true);
        });

        it('cli account add - use explicit flag allow_bucket_creation true (case insensitive)', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const allow_bucket_creation = 'TRUE';
            const account_options = { config_root, name, new_buckets_path, uid, gid, allow_bucket_creation };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
            expect(account.allow_bucket_creation).toBe(true);
        });

        it('cli account add - use explicit flag allow_bucket_creation (boolean type))', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const allow_bucket_creation = true; // boolean (not string)
            const account_options = { config_root, name, new_buckets_path, uid, gid, allow_bucket_creation };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
            expect(account.allow_bucket_creation).toBe(true);
        });

        it('cli account add - use explicit flag allow_bucket_creation false', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const allow_bucket_creation = 'false';
            const account_options = { config_root, name, new_buckets_path, uid, gid, allow_bucket_creation };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
            expect(account.allow_bucket_creation).toBe(false);
        });

        it('cli account add - use explicit flag allow_bucket_creation false (case insensitive)', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const allow_bucket_creation = 'FALSE';
            const account_options = { config_root, name, new_buckets_path, uid, gid, allow_bucket_creation };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
            expect(account.allow_bucket_creation).toBe(false);
        });

        it('should fail - cli account add - use explicit flag allow_bucket_creation invalid string value', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const allow_bucket_creation = 'blabla'; // invalid value
            const account_options = { config_root, name, new_buckets_path, uid, gid, allow_bucket_creation };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidBooleanValue.code);
        });

        it('should fail - cli account add - use explicit flag allow_bucket_creation invalid type', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const allow_bucket_creation = 1234; // invalid value
            const account_options = { config_root, name, new_buckets_path, uid, gid, allow_bucket_creation };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgumentType.code);
        });

        it('cli create account - check for the symlink relative path, not absolute path', async () => {
            const action = ACTIONS.ADD;
            const { type, access_key, secret_key, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, access_key, secret_key, name, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
            const account_symlink = await config_fs.get_account_by_access_key(access_key, config_fs_account_options);
            assert_account(account_symlink, account_options);
            const real_path = fs.readlinkSync(config_fs.get_account_or_user_path_by_access_key(access_key));
            expect(real_path).toContain(config_fs.get_account_relative_path_by_id(account._id));
        });

        it('cli account add - use flag force_md5_etag', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const force_md5_etag = true;
            const account_options = { config_root, name, new_buckets_path, uid, gid, force_md5_etag };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            expect(account.force_md5_etag).toBe(true);
        });

        it('cli account add - use flag iam_operate_on_root_account (true)', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const iam_operate_on_root_account = 'true';
            const account_options = { config_root, name, new_buckets_path, uid, gid,
                iam_operate_on_root_account };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            expect(account.iam_operate_on_root_account).toBe(true);
            expect(account.allow_bucket_creation).toBe(true);
        });

        it('cli account add - use flag iam_operate_on_root_account (false)', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const iam_operate_on_root_account = 'false';
            const account_options = { config_root, name, new_buckets_path, uid, gid,
                iam_operate_on_root_account };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            expect(account.iam_operate_on_root_account).toBe(false);
            expect(account.allow_bucket_creation).toBe(true); // by default it is inferred when we have new_buckets_path
        });

        it('cli account add - use flag iam_operate_on_root_account (true) ' +
            'with allow_bucket_creation (true)', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const iam_operate_on_root_account = 'true';
            const allow_bucket_creation = 'true'; // root accounts manager is not allowed to create buckets
            const account_options = { config_root, name, new_buckets_path, uid, gid,
                iam_operate_on_root_account, allow_bucket_creation };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res).response.code).toEqual(ManageCLIResponse.AccountCreated.code);
        });

        it('should fail - cli account add invalid flags combination (gid and user)', async function() {
            const action = ACTIONS.ADD;
            const { type, name, gid } = defaults;
            const account_options = { config_root, name, gid, user: 'root' };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidFlagsCombination.code);
        });

        it('should fail - cli account add invalid flags combination (uid and user)', async function() {
            const action = ACTIONS.ADD;
            const { type, name, uid } = defaults;
            const account_options = { config_root, name, uid, user: 'root' };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidFlagsCombination.code);
        });

        it('should fail - cli account add invalid flags combination (uid, gid and user)', async function() {
            const action = ACTIONS.ADD;
            const { type, name, uid, gid } = defaults;
            const account_options = { config_root, name, uid, gid, user: 'root' };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidFlagsCombination.code);
        });

        it('should fail - cli account add invalid account name(anonymous)', async function() {
            const action = ACTIONS.ADD;
            const { type, uid, gid } = defaults;
            const name = ANONYMOUS;
            const account_options = { config_root, name, uid, gid };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountName.code);
        });

        it('should fail - cli account add - without identifier', async function() {
            const action = ACTIONS.ADD;
            const { type, new_buckets_path, uid, gid } = defaults; // without name
            const account_options = { config_root, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.MissingAccountNameFlag.code);
        });

        it('should fail - cli create account invalid option (new_name)', async () => {
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, name, new_buckets_path, uid, gid, new_name: 'lala'}; // new_name invalid option in add
            const action = ACTIONS.ADD;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create account invalid option (new_access_key)', async () => {
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, name, new_buckets_path, uid, gid, new_access_key: 'GIGiFAnjaaE7OKD5N7lB'}; // new_access_key invalid option
            const action = ACTIONS.ADD;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create account invalid name (more than max length)', async () => {
            const { type, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, name: 'A'.repeat(100), new_buckets_path, uid, gid}; // invalid name (too long)
            const action = ACTIONS.ADD;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountName.code);
        });

        it('should fail - cli create account invalid name (anonymous)', async () => {
            const { type, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, name: 'anonymous', new_buckets_path, uid, gid}; // invalid name (too long)
            const action = ACTIONS.ADD;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountName.code);
        });

        it('should fail - cli create account invalid name (from internal list)', async () => {
            const { type, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, name: '.', new_buckets_path, uid, gid}; // invalid name (we don't allow '.' as name)
            const action = ACTIONS.ADD;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountName.code);
        });

        it('cli account add - cli create account with supplemental groups)', async function() {
            const { type, new_buckets_path, uid, gid, name } = defaults;
            const supplemental_groups = '303,211';
            const expected_groups = [303, 211];
            const account_options = { config_root, name, new_buckets_path, uid, gid, supplemental_groups};
            const action = ACTIONS.ADD;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);
        });

        it('cli account add - cli create account with supplemental groups - single group (string))', async function() {
            const { type, new_buckets_path, uid, gid, name } = defaults;
            const supplemental_groups = '303';
            const expected_groups = [303];
            const account_options = { config_root, name, new_buckets_path, uid, gid, supplemental_groups};
            const action = ACTIONS.ADD;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);
        });

        it('cli account add - cli create account with supplemental groups - single group (number))', async function() {
            const { type, new_buckets_path, uid, gid, name } = defaults;
            const supplemental_groups = 303;
            const expected_groups = [303];
            const account_options = { config_root, name, new_buckets_path, uid, gid, supplemental_groups};
            const action = ACTIONS.ADD;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);
        });

        it('cli account add - cli create account with supplemental groups - invalid list', async function() {
            const { type, new_buckets_path, uid, gid, name } = defaults;
            const supplemental_groups = '303l,201'; //group cannot contain characters
            const account_options = { config_root, name, new_buckets_path, uid, gid, supplemental_groups};
            const action = ACTIONS.ADD;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidSupplementalGroupsList.code);
        });

        it('cli account add - cli create account with supplemental groups - invalid list end with comma', async function() {
            const { type, new_buckets_path, uid, gid, name } = defaults;
            const supplemental_groups = '303,'; //group cannot end with comma
            const account_options = { config_root, name, new_buckets_path, uid, gid, supplemental_groups};
            const action = ACTIONS.ADD;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidSupplementalGroupsList.code);
        });

        it('cli account add - with account name suffix `.json`', async function() {
            const action = ACTIONS.ADD;
            const { type, new_buckets_path, uid, gid } = defaults;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            const name = 'account_suffix.json';
            const account_options = { config_root, name, new_buckets_path, uid, gid };
            const res = await exec_manage_cli(type, action, account_options);
            const parse_res = JSON.parse(res);
            expect(parse_res.response.code).toEqual(ManageCLIResponse.AccountCreated.code);
            expect(parse_res.response.reply.name).toEqual(name);
            const account = await config_fs.get_account_by_name(name);
            expect(account.name).toBe(name);
            const res1 = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.STATUS, { name, config_root });
            expect(JSON.parse(res1).response.reply.name).toBe(name);
            const res_list = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.LIST, { config_root });
            expect(JSON.parse(res_list).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining([name]));
        });

        it('cli account add - with account name suffix `.symlink`', async function() {
            const action = ACTIONS.ADD;
            const { type, new_buckets_path, uid, gid } = defaults;
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            const name = 'account_suffix.symlink';
            const account_options = { config_root, name, new_buckets_path, uid, gid };
            const res = await exec_manage_cli(type, action, account_options);
            const parse_res = JSON.parse(res);
            expect(parse_res.response.code).toEqual(ManageCLIResponse.AccountCreated.code);
            expect(parse_res.response.reply.name).toEqual(name);
            const account = await config_fs.get_account_by_name(name);
            expect(account.name).toBe(name);
            const res1 = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.STATUS, { name, config_root });
            expect(JSON.parse(res1).response.reply.name).toBe(name);
            const res_list = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.LIST, { config_root });
            expect(JSON.parse(res_list).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining([name]));
        });

        it('cli account add - default connection', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const default_connection = 'defcon';
            const account_options = { config_root, name, new_buckets_path, uid, gid, default_connection };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
            expect(account.default_connection).toBe(default_connection);
        });

        it('cli account add - with custom_bucket_path_allowed_list', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const custom_bucket_path_allowed_list = '/root/bla:/my_buckets:/data/buckets';
            const account_options = { config_root, name, new_buckets_path, uid, gid, custom_bucket_path_allowed_list };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
            expect(account.nsfs_account_config.custom_bucket_path_allowed_list).toBe(custom_bucket_path_allowed_list);
        });

        it('cli account add - with bypass governance lock flag', async function() {
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const allow_bypass_governance = 'true';
            const account_options = { config_root, name, new_buckets_path, uid, gid, allow_bypass_governance };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
            expect(account.nsfs_account_config.allow_bypass_governance).toBe(true);
        });
    });

    describe('cli update account', () => {
        describe('cli update account (has uid and gid)', () => {
            const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs1');
            const config_fs = new ConfigFS(config_root);
            const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs1/');
            const type = TYPES.ACCOUNT;
            const defaults = {
                name: 'account1',
                new_buckets_path: `${root_path}new_buckets_path_user/`,
                uid: 999,
                gid: 999,
                access_key: 'GIGiFAnjaaE7OKD5N7hA',
                secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
            };

            beforeEach(async () => {
                await fs_utils.create_fresh_path(root_path);
                set_nc_config_dir_in_config(config_root);
                const action = ACTIONS.ADD;
                const { new_buckets_path } = defaults;
                const account_options = { config_root, ...defaults };
                await fs_utils.create_fresh_path(new_buckets_path);
                await fs_utils.file_must_exist(new_buckets_path);
                await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
                await exec_manage_cli(type, action, account_options);
            });

            afterEach(async () => {
                await fs_utils.folder_delete(`${config_root}`);
                await fs_utils.folder_delete(`${root_path}`);
            });

            it('cli regenerate account access_keys', async () => {
                const { name } = defaults;
                const account_options = { config_root, name, regenerate: true };
                const account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account_details.access_keys[0].access_key).not.toBe(new_account_details.access_keys[0].access_key);
                const new_access_key = new_account_details.access_keys[0].access_key;
                const account_symlink = await config_fs.get_account_by_access_key(new_access_key, config_fs_account_options);
                //fixing the new_account_details for compare. 
                new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
                assert_account(account_symlink, new_account_details);
            });

            it('cli regenerate account access_keys with value "true"', async () => {
                const { name } = defaults;
                const account_options = { config_root, name, regenerate: 'true' };
                const account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account_details.access_keys[0].access_key).not.toBe(new_account_details.access_keys[0].access_key);
                const new_access_key = new_account_details.access_keys[0].access_key;
                const account_symlink = await config_fs.get_account_by_access_key(new_access_key, config_fs_account_options);
                //fixing the new_account_details for compare. 
                new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
                assert_account(account_symlink, new_account_details);
            });

            it('cli regenerate account access_keys with value "TRUE" (case insensitive)', async () => {
                const { name } = defaults;
                const account_options = { config_root, name, regenerate: 'TRUE' };
                const account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account_details.access_keys[0].access_key).not.toBe(new_account_details.access_keys[0].access_key);
                const new_access_key = new_account_details.access_keys[0].access_key;
                const account_symlink = await config_fs.get_account_by_access_key(new_access_key, config_fs_account_options);
                //fixing the new_account_details for compare. 
                new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
                assert_account(account_symlink, new_account_details);
            });

            it('cli regenerate account access_keys with value "false"', async () => {
                const { name } = defaults;
                const account_options = { config_root, name, regenerate: 'false' };
                const account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                const new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account_details.access_keys[0].access_key).toBe(new_account_details.access_keys[0].access_key);
            });

            it('cli regenerate account access_keys with value "FALSE" (case insensitive)', async () => {
                const { name } = defaults;
                const account_options = { config_root, name, regenerate: 'FALSE' };
                const account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                const new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account_details.access_keys[0].access_key).toBe(new_account_details.access_keys[0].access_key);
            });

            it('should fail - regenerate account access_keys with invalid string value', async function() {
                const { name } = defaults;
                const account_options = { config_root, name, regenerate: 'blabla' };
                const action = ACTIONS.UPDATE;
                const res = await exec_manage_cli(type, action, account_options);
                expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidBooleanValue.code);
            });

            it('should fail - regenerate account access_keys with invalid type', async function() {
                const { name } = defaults;
                const account_options = { config_root, name, regenerate: 1234 };
                const action = ACTIONS.UPDATE;
                const res = await exec_manage_cli(type, action, account_options);
                expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgumentType.code);
            });

            it('cli account update name by name', async function() {
                const { name } = defaults;
                const new_name = 'account1_new_name';
                const account_options = { config_root, name, new_name };
                const action = ACTIONS.UPDATE;
                account_options.new_name = 'account1_new_name';
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(new_name, config_fs_account_options);
                expect(new_account_details.name).toBe(new_name);
                const access_key = new_account_details.access_keys[0].access_key;
                const account_symlink = await config_fs.get_account_by_access_key(access_key, config_fs_account_options);
                //fixing the new_account_details for compare. 
                new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
                assert_account(account_symlink, new_account_details);
            });

            it('cli account update name undefined (and back to original name)', async function() {
                // set the name as undefined
                let name = defaults.name;
                let new_name = 'undefined'; // it is string on purpose
                let account_options = { config_root, name, new_name };
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(new_name, config_fs_account_options);
                expect(new_account_details.name).toBe(new_name);

                // set the name as back as it was
                let temp = name; // we swap between name and new_name
                name = new_name;
                new_name = temp;
                account_options = { config_root, name, new_name };
                await exec_manage_cli(type, action, account_options);
                new_account_details = await config_fs.get_account_by_name(new_name, config_fs_account_options);
                expect(new_account_details.name).toBe(new_name);

                // set the name as undefined (not string)
                name = defaults.name;
                new_name = undefined;
                account_options = { config_root, name, new_name };
                await exec_manage_cli(type, action, account_options);
                new_account_details = await config_fs.get_account_by_name(new_name, config_fs_account_options);
                expect(new_account_details.name).toBe(String(new_name));

                // set the name as back as it was
                temp = name; // we swap between name and new_name
                name = String(new_name);
                new_name = temp;
                account_options = { config_root, name, new_name };
                await exec_manage_cli(type, action, account_options);
                new_account_details = await config_fs.get_account_by_name(new_name, config_fs_account_options);
                expect(new_account_details.name).toBe(new_name);
            }, timeout);

            it('cli account update access key, secret_key & new_name by name', async function() {
                const { name } = defaults;
                const new_name = 'account1_new_name';
                const access_key = 'GIGiFAnjaaE7OKD5N7hB';
                const secret_key = 'U3AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE';
                const account_options = { config_root, name, new_name, access_key, secret_key };
                const account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                await config_fs.get_account_by_access_key(defaults.access_key, config_fs_account_options);

                const action = ACTIONS.UPDATE;
                account_options.new_name = 'account1_new_name';
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(new_name, config_fs_account_options);

                expect(new_account_details.name).toBe(new_name);
                expect(account_details.access_keys[0].access_key).not.toBe(new_account_details.access_keys[0].access_key);
                expect(account_details.access_keys[0].secret_key).not.toBe(new_account_details.access_keys[0].secret_key);
                expect(new_account_details.access_keys[0].access_key).toBe(access_key);
                const account_symlink = await config_fs.get_account_by_access_key(access_key, config_fs_account_options);
                //fixing the new_account_details for compare. 
                new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
                assert_account(account_symlink, new_account_details);
            });

            it('cli update account access_key and secret_key using flags', async () => {
                const { name } = defaults;
                const access_key = 'GIGiFAnjaaE7OKD5N7hB';
                const secret_key = 'U3AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE';
                const account_options = { config_root, name, access_key, secret_key };
                const account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account_details.access_keys[0].access_key).not.toBe(new_account_details.access_keys[0].access_key);
                expect(account_details.access_keys[0].secret_key).not.toBe(new_account_details.access_keys[0].secret_key);
                expect(new_account_details.access_keys[0].access_key).toBe(access_key);
                const account_symlink = await config_fs.get_account_by_access_key(access_key, config_fs_account_options);
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

            it('should fail - cli update account invalid option type (user as boolean)', async () => {
                const { name } = defaults;
                const account_options = { config_root, name};
                const action = ACTIONS.UPDATE;
                const command = create_command(type, action, account_options);
                const flag = 'user'; // we will add user flag without value
                const res = await exec_manage_cli_add_empty_option(command, flag);
                expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgumentType.message);
            });

            it('cli update account unset new_buckets_path', async () => {
                const { name } = defaults;
                //in exec_manage_cli an empty string is passed as no input. so operation fails on invalid type. use the string '' instead 
                const account_options = { config_root, name, new_buckets_path: CLI_UNSET_EMPTY_STRING};
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.nsfs_account_config.new_buckets_path).toBeUndefined();
                expect(new_account_details.allow_bucket_creation).toBe(false);

                //set new_buckets_path value back to its original value
                account_options.new_buckets_path = defaults.new_buckets_path;
                await exec_manage_cli(type, action, account_options);
                new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.nsfs_account_config.new_buckets_path).toBe(defaults.new_buckets_path);
                expect(new_account_details.allow_bucket_creation).toBe(true);
            });

            it('cli account update account by name, access_key and secret_key - check for the symlink relative path, not absolute path', async function() {
                const { name } = defaults;
                const new_name = 'account1_new_name';
                const access_key = 'GIGiFAnjaaE7OEXAMPLE';
                const secret_key = 'U3AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE';
                const account_options = { config_root, name, new_name, access_key, secret_key };
                const action = ACTIONS.UPDATE;
                account_options.new_name = 'account1_new_name';
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(new_name, config_fs_account_options);
                const account_symlink = await config_fs.get_account_by_access_key(access_key, config_fs_account_options);
                //fixing the new_account_details for compare. 
                new_account_details = { ...new_account_details, ...new_account_details.nsfs_account_config };
                assert_account(account_symlink, new_account_details);
                const real_path = fs.readlinkSync(config_fs.get_account_or_user_path_by_access_key(access_key));
                expect(real_path).toContain(config_fs.get_account_relative_path_by_id(new_account_details._id));
            });

            it('cli update account set flag force_md5_etag', async function() {
                const { name } = defaults;
                const account_options = { config_root, name, force_md5_etag: 'true'};
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.force_md5_etag).toBe(true);

                account_options.force_md5_etag = 'false';
                await exec_manage_cli(type, action, account_options);
                new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.force_md5_etag).toBe(false);
            });

            it('cli update account unset flag force_md5_etag', async function() {
                // first set the value of force_md5_etag to be true
                const { name } = defaults;
                const account_options = { config_root, name, force_md5_etag: 'true'};
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.force_md5_etag).toBe(true);

                // unset force_md5_etag
                account_options.force_md5_etag = CLI_UNSET_EMPTY_STRING;
                await exec_manage_cli(type, action, account_options);
                new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.force_md5_etag).toBeUndefined();
            });

            it('cli update account set flag iam_operate_on_root_account', async function() {
                const { name } = defaults;
                const account_options = { config_root, name, iam_operate_on_root_account: 'true'};
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.iam_operate_on_root_account).toBe(true);

                account_options.iam_operate_on_root_account = 'false';
                await exec_manage_cli(type, action, account_options);
                new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.iam_operate_on_root_account).toBe(false);
            });

            it(`should fail - cli update account unset flag iam_operate_on_root_account with ''`, async function() {
                // first set the value of iam_operate_on_root_account to be true
                const { name } = defaults;
                const account_options = { config_root, name, iam_operate_on_root_account: 'true'};
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                const new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.iam_operate_on_root_account).toBe(true);

                // unset iam_operate_on_root_account (is not allowed)
                account_options.iam_operate_on_root_account = CLI_UNSET_EMPTY_STRING;
                const res = await exec_manage_cli(type, action, account_options);
                expect(JSON.parse(res.stdout).error.code).toBe(
                    ManageCLIError.InvalidArgumentType.code);
            });

            it(`should fail - cli update account unset flag access_key with ''`, async function() {
                // unset access_key (is not allowed)
                const action = ACTIONS.UPDATE;
                const { name } = defaults;
                const account_options = { config_root, name, access_key: CLI_UNSET_EMPTY_STRING };
                const res = await exec_manage_cli(type, action, account_options);
                expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.UnsetArgumentIsInvalid.code);
            });

            it('cli update account iam_operate_on_root_account true when account owns a bucket', async function() {
                // cli create bucket
                const bucket_name = 'my-bucket';
                let action = ACTIONS.ADD;
                const { new_buckets_path } = defaults;
                const account_name = defaults.name;
                const bucket_options = { config_root, path: new_buckets_path, name: bucket_name, owner: account_name};
                await exec_manage_cli(TYPES.BUCKET, action, bucket_options);

                // set the value of iam_operate_on_root_account to be true
                const { name } = defaults;
                const account_options = { config_root, name, iam_operate_on_root_account: 'true'};
                action = ACTIONS.UPDATE;
                const res = await exec_manage_cli(type, action, account_options);
                expect(JSON.parse(res).response.code).toEqual(ManageCLIResponse.AccountUpdated.code);
            });

            it('should fail - cli update account iam_operate_on_root_account true when account owns IAM accounts', async function() {
                const { name } = defaults;
                const accounts_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                const account_id = accounts_details._id;

                const account_name = 'account-to-be-owned';
                const account_options1 = { config_root, name: account_name, uid: 5555, gid: 5555 };
                await exec_manage_cli(type, ACTIONS.ADD, account_options1);

                // update the account to have the property owner
                // (we use this way because now we don't have the way to create IAM users through the noobaa cli)
                const config_data = await config_fs.get_account_by_name(account_name, config_fs_account_options);
                config_data.owner = account_id; // just so we can identify this account as IAM user
                await config_fs.update_account_config_file(config_data);
                // set the value of iam_operate_on_root_account to be true
                const account_options2 = { config_root, name, iam_operate_on_root_account: true};
                const res = await exec_manage_cli(type, ACTIONS.UPDATE, account_options2);
                expect(JSON.parse(res.stdout).error.code).toBe(
                    ManageCLIError.AccountCannotBeRootAccountsManager.code);
            });

            it('should fail - cli update account iam_operate_on_root_account true when requester is IAM user', async function() {
                // update the account to have the property owner
                // (we use this way because now we don't have the way to create IAM users through the noobaa cli)
                const { name } = defaults;
                const config_data = await config_fs.get_account_by_name(name, config_fs_account_options);
                config_data.owner = '65a62e22ceae5e5f1a758aa9'; // just so we can identify this account as IAM user
                await config_fs.update_account_config_file(config_data);
                // set the value of iam_operate_on_root_account to be true
                const account_options = { config_root, name, iam_operate_on_root_account: 'true'};
                const action = ACTIONS.UPDATE;
                const res = await exec_manage_cli(type, action, account_options);
                expect(JSON.parse(res.stdout).error.code).toBe(
                    ManageCLIError.AccountCannotCreateRootAccountsRequesterIAMUser.code);
            });

            it('should fail - cli update account without a property to update', async () => {
                const action = ACTIONS.UPDATE;
                const { name } = defaults;
                const account_options = { config_root, name };
                const res = await exec_manage_cli(type, action, account_options);
                expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.MissingUpdateProperty.message);
            });

            it('should fail - cli update account without a property to update (regenerate false)', async () => {
                const action = ACTIONS.UPDATE;
                const { name } = defaults;
                const account_options = { config_root, name, regenerate: 'false' };
                const res = await exec_manage_cli(type, action, account_options);
                expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.MissingUpdateProperty.message);
            });

            it('cli update account that has uid and gid with distinguished name', async () => {
                const action = ACTIONS.UPDATE;
                const { name, new_buckets_path } = defaults;
                const distinguished_name = 'root';
                const account_options = { config_root, name, user: distinguished_name };
                await set_path_permissions_and_owner(new_buckets_path, { uid: 0, gid: 0 }, 0o700);
                await exec_manage_cli(type, action, account_options);
                const account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account_details.nsfs_account_config.uid).toBeUndefined();
                expect(account_details.nsfs_account_config.gid).toBeUndefined();
                expect(account_details.nsfs_account_config.distinguished_name).toBe(distinguished_name);
            });

            it('should fail - cli update account with invalid new_name (anonymous)', async () => {
                const action = ACTIONS.UPDATE;
                const { name } = defaults;
                const new_name = ANONYMOUS;
                const account_options = { config_root, name, new_name};
                const res = await exec_manage_cli(type, action, account_options);
                expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidAccountName.message);
            });

            it('should fail - cli update account with invalid name (anonymous)', async () => {
                const action = ACTIONS.UPDATE;
                const new_name = 'new-account';
                const account_options = { config_root, name: 'anonymous', new_name};
                const res = await exec_manage_cli(type, action, account_options);
                expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidAccountName.message);
            });

            it('should fail - cli account update - without identifier', async () => {
                const account_options = { config_root, regenerate: true }; // without name
                const action = ACTIONS.UPDATE;
                const res = await exec_manage_cli(type, action, account_options);
                expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.MissingAccountNameFlag.code);
            });

            it('cli update iam account with regenerate (only object access keys in index 0 changes)', async function() {
                const { name } = defaults;
                const accounts_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                const account_id = accounts_details._id;

                const account_name = 'account-to-be-owned';
                const account_options1 = { config_root, name: account_name, uid: 5555, gid: 5555 };
                await exec_manage_cli(type, ACTIONS.ADD, account_options1);

                // update the account to have the property owner
                // (we use this way because now we don't have the way to create IAM users through the noobaa cli)
                const config_data = await config_fs.get_account_by_name(account_name, config_fs_account_options);
                config_data.owner = account_id; // just so we can identify this account as IAM user
                // add additional properties to access_keys_object
                config_data.access_keys[0].creation_date = '2024-07-10T11:26:34.569Z';
                config_data.access_keys[0].deactivated = false;
                await config_fs.update_account_config_file(config_data);
                // regenerate (auto change the access keys in index 0 only)
                const account_options2 = { config_root, name, regenerate: true};
                const res = await exec_manage_cli(type, ACTIONS.UPDATE, account_options2);
                expect(JSON.parse(res).response.code).toEqual(ManageCLIResponse.AccountUpdated.code);
                expect(JSON.parse(res).response.reply.access_keys[0].creation_date).toBeUndefined();
                expect(JSON.parse(res).response.reply.access_keys[0].deactivated).toBeUndefined();
            });

            it('cli update iam account with access_key and secret_key flag (only object access keys in index 0 changes)', async function() {
                const { name } = defaults;
                const accounts_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                const account_id = accounts_details._id;

                const account_name = 'account-to-be-owned';
                const account_options1 = { config_root, name: account_name, uid: 5555, gid: 5555 };
                await exec_manage_cli(type, ACTIONS.ADD, account_options1);

                // update the account to have the property owner
                // (we use this way because now we don't have the way to create IAM users through the noobaa cli)
                const config_data = await config_fs.get_account_by_name(account_name, config_fs_account_options);
                config_data.owner = account_id; // just so we can identify this account as IAM user
                // add additional properties to access_keys_object
                config_data.access_keys[0].creation_date = '2024-07-10T11:26:34.569Z';
                config_data.access_keys[0].deactivated = false;
                await config_fs.update_account_config_file(config_data);
                // update access_key and secret_key (change the access keys in index 0 only)
                const access_key = 'GIGiFAnjsaE7OKg5N7hB';
                const secret_key = 'U3AYaMpU3zRDcRKWmvzgTr9MoHIAsD+3oEXAMPLE';
                const account_options2 = { config_root, name, access_key, secret_key};
                const res = await exec_manage_cli(type, ACTIONS.UPDATE, account_options2);
                expect(JSON.parse(res).response.code).toEqual(ManageCLIResponse.AccountUpdated.code);
                expect(JSON.parse(res).response.reply.access_keys[0].creation_date).toBeUndefined();
                expect(JSON.parse(res).response.reply.access_keys[0].deactivated).toBeUndefined();
                expect(JSON.parse(res).response.reply.access_keys[0].access_key).toBe(access_key);
                expect(JSON.parse(res).response.reply.access_keys[0].secret_key).toBe(secret_key);
            });

            it('should fail - cli update account invalid new_name (more than max length)', async () => {
                const { name } = defaults;
                const account_options = { config_root, name, new_name: 'A'.repeat(100)}; // invalid new_name (too long)
                const res = await exec_manage_cli(type, ACTIONS.UPDATE, account_options);
                expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountName.code);
            });

            it('should fail - cli update account invalid name (from internal list)', async () => {
                const { name } = defaults;
                const account_options = { config_root, name, new_name: '.'}; // invalid new_name (we don't allow '.' as name)
                const res = await exec_manage_cli(type, ACTIONS.UPDATE, account_options);
                expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountName.code);
            });

            it('cli account update - cli update account with supplemental groups)', async function() {
                const { name } = defaults;
                const supplemental_groups = '303,211';
                const expected_groups = [303, 211];
                const account_options = { config_root, name, supplemental_groups};
                await exec_manage_cli(type, ACTIONS.UPDATE, account_options);
                const account = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);
            });

            it('cli account update - cli update account with supplemental groups - single group (string))', async function() {
                const { name } = defaults;
                const supplemental_groups = '303';
                const expected_groups = [303];
                const account_options = { config_root, name, supplemental_groups};
                await exec_manage_cli(type, ACTIONS.UPDATE, account_options);
                const account = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);
            });

            it('cli account update - cli update account with supplemental groups - single group (number))', async function() {
                const { name } = defaults;
                const supplemental_groups = 303;
                const expected_groups = [303];
                const account_options = { config_root, name, supplemental_groups};
                await exec_manage_cli(type, ACTIONS.UPDATE, account_options);
                const account = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);
            });

            it('cli account update - cli update account with empty supplemental groups (unset)', async function() {
                const { name } = defaults;
                const supplemental_groups = '303,211';
                const expected_groups = [303, 211];
                const empty_set = '\'\'';
                const account_options = { config_root, name, supplemental_groups};
                await exec_manage_cli(type, ACTIONS.UPDATE, account_options);
                const account = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);

                //unset the value
                account_options.supplemental_groups = empty_set;
                await exec_manage_cli(type, ACTIONS.UPDATE, account_options);
                const updated_account = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(updated_account.nsfs_account_config.supplemental_groups).toBeUndefined();
            });

            it('cli account update - cli update account with no supplemental groups - list remains the same', async function() {
                const { name } = defaults;
                const supplemental_groups = '303,211';
                const expected_groups = [303, 211];
                const account_options = { config_root, name, supplemental_groups};
                await exec_manage_cli(type, ACTIONS.UPDATE, account_options);
                const account = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);

                //unset the value
                const new_account_options = {config_root, name};
                await exec_manage_cli(type, ACTIONS.UPDATE, new_account_options);
                const updated_account = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(updated_account.nsfs_account_config.supplemental_groups).toStrictEqual(expected_groups);
            });

            it('cli update account unset custom_bucket_path_allowed_list', async () => {
                const { name } = defaults;
                //in exec_manage_cli an empty string is passed as no input. so operation fails on invalid type. use the string '' instead 
                const account_options = { config_root, name, custom_bucket_path_allowed_list: CLI_UNSET_EMPTY_STRING};
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.nsfs_account_config.custom_bucket_path_allowed_list).toBeUndefined();

                //set new_buckets_path value back to its original value
                account_options.custom_bucket_path_allowed_list = "/some/path/:/another/path/";
                await exec_manage_cli(type, action, account_options);
                new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.nsfs_account_config.custom_bucket_path_allowed_list).toBe("/some/path/:/another/path/");
            });

            it('cli update account with bypass governance lock flag', async function() {
                const { name } = defaults;
                const account_options = { config_root, name, allow_bypass_governance: 'true'};
                const action = ACTIONS.UPDATE;
                await exec_manage_cli(type, action, account_options);
                let new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.nsfs_account_config.allow_bypass_governance).toBe(true);

                account_options.allow_bypass_governance = 'false';
                await exec_manage_cli(type, action, account_options);
                new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.nsfs_account_config.allow_bypass_governance).toBe(false);

                account_options.allow_bypass_governance = '';
                await exec_manage_cli(type, action, account_options);
                new_account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(new_account_details.nsfs_account_config.allow_bypass_governance).toBe(undefined);
            });
        });

        describe('cli update account (has distinguished name)', () => {
            const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs2');
            const config_fs = new ConfigFS(config_root);
            const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs2/');
            const type = TYPES.ACCOUNT;
            const distinguished_name = 'root';
            const defaults = {
                name: 'account2',
                new_buckets_path: `${root_path}new_buckets_path_user2/`,
                user: distinguished_name,
                access_key: 'HIGiFAnjaaE7OKD5N7hB',
                secret_key: 'V2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3tEXAMPLE',
            };

            beforeEach(async () => {
                await fs_utils.create_fresh_path(root_path);
                set_nc_config_dir_in_config(config_root);
                const action = ACTIONS.ADD;
                const { new_buckets_path } = defaults;
                const account_options = { config_root, ...defaults };
                await fs_utils.create_fresh_path(new_buckets_path);
                await fs_utils.file_must_exist(new_buckets_path);
                await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
                await exec_manage_cli(type, action, account_options);
            });

            afterEach(async () => {
                await fs_utils.folder_delete(`${config_root}`);
                await fs_utils.folder_delete(`${root_path}`);
            });

            it('cli update account that has distinguished name with uid and gid', async () => {
                const action = ACTIONS.UPDATE;
                const { name, new_buckets_path } = defaults;
                const uid = 1003;
                const gid = 1003;
                const account_options = { config_root, name, uid, gid };
                await set_path_permissions_and_owner(new_buckets_path, { uid, gid }, 0o700);
                await exec_manage_cli(type, action, account_options);
                const account_details = await config_fs.get_account_by_name(name, config_fs_account_options);
                expect(account_details.nsfs_account_config.uid).toBe(uid);
                expect(account_details.nsfs_account_config.gid).toBe(gid);
                expect(account_details.nsfs_account_config.distinguished_name).toBeUndefined();
            });
        });
    });

    describe('cli list account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs3');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs3/');
        const type = TYPES.ACCOUNT;
        const defaults = [{
            name: 'account1',
            new_buckets_path: `${root_path}new_buckets_path_user1/`,
            uid: 999,
            gid: 999,
            access_key: 'GIGiFAnjaaE7OKD5N7hA',
            secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        }, {
            name: 'account2',
            new_buckets_path: `${root_path}new_buckets_path_user2/`,
            uid: 888,
            gid: 888,
            access_key: 'BIBiFAnjaaE7OKD5N7hA',
            secret_key: 'BIBYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        }, {
            name: 'account3',
            new_buckets_path: `${root_path}new_buckets_path_user3/`,
            uid: 999,
            gid: 888,
            access_key: 'TIBiFAnjaaE7OKD5N7hA',
            secret_key: 'BITYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
            },
        {
            name: 'account4',
            new_buckets_path: `${root_path}new_buckets_path_user4/`,
            user: 'root',
            access_key: 'DIBiFAnjaaE7OKD5N7hA',
            secret_key: 'BITYaMpU3zRDcRFWmvzgQr9MoHIAsD+3oEXAMPLE',
        }];

        beforeAll(async () => {
            await fs_utils.create_fresh_path(root_path);
            set_nc_config_dir_in_config(config_root);
            // Creating the account
            const action = ACTIONS.ADD;
            for (const account_defaults of Object.values(defaults)) {
                let account_options = { config_root };
                account_options = { ...account_options, ...account_defaults };
                await fs_utils.create_fresh_path(account_options.new_buckets_path);
                await fs_utils.file_must_exist(account_options.new_buckets_path);
                await set_path_permissions_and_owner(account_options.new_buckets_path, account_options, 0o700);
                await exec_manage_cli(type, action, account_options);
            }
        }, timeout);

        afterAll(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
        });

        it('cli list', async () => {
            const account_options = { config_root };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account2', 'account1']));
        });

        it('cli list wide', async () => {
            const account_options = { config_root, wide: true };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account2', 'account1']));
            // added additional properties that we can see with wide option (uid, new_buckets_path)
            expect(JSON.parse(res).response.reply.map(item => item.nsfs_account_config.uid))
                .toEqual(expect.arrayContaining([999, 888]));
            expect(JSON.parse(res).response.reply.map(item => item.nsfs_account_config.new_buckets_path))
                .toEqual(expect.arrayContaining([`${root_path}new_buckets_path_user1/`,
                    `${root_path}new_buckets_path_user2/`, `${root_path}new_buckets_path_user3/`]));
        });

        it('cli list wide (use the flag with value "true"', async () => {
            const account_options = { config_root, wide: 'true' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account2', 'account1']));
            // added additional properties that we can see with wide option (uid, new_buckets_path)
            expect(JSON.parse(res).response.reply.map(item => item.nsfs_account_config.uid))
                .toEqual(expect.arrayContaining([999, 888]));
            expect(JSON.parse(res).response.reply.map(item => item.nsfs_account_config.new_buckets_path))
                .toEqual(expect.arrayContaining([`${root_path}new_buckets_path_user1/`,
                    `${root_path}new_buckets_path_user2/`, `${root_path}new_buckets_path_user3/`]));
        });

        it('cli list wide (use the flag with value "TRUE" (case insensitive)', async () => {
            const account_options = { config_root, wide: 'TRUE' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account2', 'account1']));
            // added additional properties that we can see with wide option (uid, new_buckets_path)
            expect(JSON.parse(res).response.reply.map(item => item.nsfs_account_config.uid))
                .toEqual(expect.arrayContaining([999, 888]));
            expect(JSON.parse(res).response.reply.map(item => item.nsfs_account_config.new_buckets_path))
                .toEqual(expect.arrayContaining([`${root_path}new_buckets_path_user1/`,
                    `${root_path}new_buckets_path_user2/`, `${root_path}new_buckets_path_user3/`]));
        });

        it('cli list wide (use the flag with value "false"', async () => {
            const account_options = { config_root, wide: 'false' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account2', 'account1']));
        });

        it('cli list wide (use the flag with value "FALSE" (case insensitive)', async () => {
            const account_options = { config_root, wide: 'FALSE' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account2', 'account1']));
        });

        it('should fail - list wide with invalid string value', async function() {
            const account_options = { config_root, wide: 'blabla' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidBooleanValue.code);
        });

        it('should fail - list wide with invalid type', async function() {
            const account_options = { config_root, wide: 1234 };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgumentType.code);
        });

        it('cli list wide (use = as flags separator)', async () => {
            const action = ACTIONS.LIST;
            const command = `node src/cmd/manage_nsfs ${type} ${action} --config_root=${config_root} --wide`;
            let res;
            try {
                res = await os_util.exec(command, { return_stdout: true });
            } catch (e) {
                res = e;
            }
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account2', 'account1']));
        });

        it('cli list filter by UID', async () => {
            const account_options = { config_root, uid: 999 };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account1']));
        });

        it('cli list filter by GID', async () => {
            const account_options = { config_root, gid: 999 };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account1']));
        });

        it('cli list filter by UID and GID (account 1)', async () => {
            const account_options = { config_root, uid: 999, gid: 999 };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account1']));
        });

        it('cli list filter by UID and GID (account 3)', async () => {
            const account_options = { config_root, uid: 999, gid: 888 };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
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
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account4']));
        });

        it('cli list filter by user (none)', async () => {
            const account_options = { config_root, user: 'shaul' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual([]);
        });

        it('cli list filter by access key (account1)', async () => {
            const account_options = { config_root, access_key: 'GIGiFAnjaaE7OKD5N7hA' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account1']));
        });

        it('cli list filter by name (account3)', async () => {
            const account_options = { config_root, name: 'account3' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3']));
        });

        it('cli list filter by name (non-existing-account) - (none)', async () => {
            const account_options = { config_root, name: 'non-existing-account' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual([]);
        });

        it('cli list filter by access key (of account1) and name (of account3) - (none)', async () => {
            const account_options = { config_root, name: 'account3', access_key: 'GIGiFAnjaaE7OKD5N7hA' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual([]);
        });

        it('cli list filter by access key (non existing) and name (of account3) - (none)', async () => {
            const account_options = { config_root, name: 'account3', access_key: 'non-existing-access-key' };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(TYPES.ACCOUNT, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual([]);
        });

        it('should fail - cli account list invalid flags combination (show_secrets without wide)', async () => {
            const account_options = { config_root, show_secrets: true}; // without wide it's invalid
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidFlagsCombination.message);
        });

        it('cli list wide and show_secrets', async () => {
            const account_options = { config_root, wide: true, show_secrets: true };
            const action = ACTIONS.LIST;
            const res = await exec_manage_cli(type, action, account_options);
            expect(Array.isArray(JSON.parse(res).response.reply)).toBe(true);
            expect(JSON.parse(res).response.reply.map(item => item.name))
                .toEqual(expect.arrayContaining(['account3', 'account2', 'account1']));
            const res_arr = JSON.parse(res).response.reply;
            for (const item of res_arr) {
                expect(item.access_keys[0].secret_key).toBeDefined();
                expect(item.access_keys[0].encrypted_secret_key).toBeUndefined();
            }
        });

    });

    describe('cli delete account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs4');
        const config_fs = new ConfigFS(config_root);
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs4/');
        const defaults = {
            type: TYPES.ACCOUNT,
            name: 'account11',
            new_buckets_path: `${root_path}new_buckets_path_user111/`,
            uid: 1011,
            gid: 1011,
            access_key: 'GIGiFAnjaaE7OKD5N7h1',
            secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+31EXAMPLE',
        };

        beforeEach(async () => {
            await fs_utils.create_fresh_path(root_path);
            set_nc_config_dir_in_config(config_root);
        });

        beforeEach(async () => {
            // cli create account
            const action = ACTIONS.ADD;
            const { type, name, new_buckets_path, uid, gid } = defaults;
            const account_options = { config_root, name, new_buckets_path, uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(account_options.new_buckets_path, account_options, 0o700);
            await exec_manage_cli(type, action, account_options);
            const is_account_exists = await config_fs.is_account_exists_by_name(name);
            expect(is_account_exists).toBe(true);
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
            const message = `Account has been deleted successfully: ${name}`;
            expect(res_json.response.message).toBe(message);
            const account_by_name_exists = await config_fs.is_account_exists_by_name(name);
            expect(account_by_name_exists).toBe(false);
            const account_by_access_key_exists = await config_fs.is_account_exists_by_access_key(defaults.access_key);
            expect(account_by_access_key_exists).toBe(false);
        });

        it('cli delete account (account has 2 access keys objects)', async () => {
            // cli create account - happens in the "beforeEach"
            const { type, name } = defaults;

            // currently we don't have the ability to create 2 access keys in the noobaa-cli
            // therefore, we will mock the config as there are 2 access keys objects
            // and also create the symlink for the one that manually added
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            const account_with_2_access_keys_objects = _.cloneDeep(account);
            const access_key2 = 'AIGiFAnjaaE7OKD5N7hA';
            const secret_key2 = 'A2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+3AEXAMPLE';
            account_with_2_access_keys_objects.access_keys.push({
                access_key: access_key2,
                secret_key: secret_key2,
                creation_date: new Date().toISOString(),
                deactivated: false,
            });
            await config_fs.update_account_config_file(
                account_with_2_access_keys_objects,
                { new_access_keys_to_link: [{ access_key: access_key2 }] }
            );

            // cli delete account
            const action = ACTIONS.DELETE;
            const account_options = { config_root, name };
            const res = await exec_manage_cli(type, action, account_options);
            const res_json = JSON.parse(res.trim());
            expect(res_json.response.code).toBe(ManageCLIResponse.AccountDeleted.code);
            const name_exists = await config_fs.is_account_exists_by_name(name);
            expect(name_exists).toBe(false);
            const access_key1_exists = await config_fs.is_account_exists_by_access_key(defaults.access_key);
            expect(access_key1_exists).toBe(false);
            const access_key2_exists = await config_fs.is_account_exists_by_access_key(access_key2);
            expect(access_key2_exists).toBe(false);
        });

        it('should fail - cli delete account, account owns a bucket', async () => {
            // manipulate the account that was created and add properties of another access key object

            // cli create bucket
            let type = TYPES.BUCKET;
            const bucket_name = 'bucket111';
            let action = ACTIONS.ADD;
            const { new_buckets_path } = defaults;
            const account_name = defaults.name;
            const bucket_options = { config_root, path: new_buckets_path, name: bucket_name, owner: account_name};
            await exec_manage_cli(type, action, bucket_options);
            const is_bucket_exists = await config_fs.is_bucket_exists(bucket_name);
            expect(is_bucket_exists).toBe(true);

            // cli delete account
            type = TYPES.ACCOUNT;
            action = ACTIONS.DELETE;
            const { name } = defaults;
            const account_options = { config_root, name };
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.AccountDeleteForbiddenHasBuckets.code);
            const is_account_exists = await config_fs.is_account_exists_by_name(name);
            expect(is_account_exists).toBe(true);
        });

        it('should fail - cli delete account invalid option (lala)', async () => {
            const action = ACTIONS.DELETE;
            const { type, name } = defaults;
            const account_options = { config_root, name, lala: 'lala'}; // lala invalid option
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
        });

        it('should fail - cli delete account invalid option (access_key)', async () => {
            // access_key was identifier of account delete in the past, but not anymore
            const action = ACTIONS.DELETE;
            const { type, access_key } = defaults;
            const account_options = { config_root, access_key};
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidArgument.message);
        });

        it('should fail - cli account delete - without identifier', async () => {
            const action = ACTIONS.DELETE;
            const { type } = defaults;
            const account_options = { config_root}; // without name
            const res = await exec_manage_cli(type, action, account_options);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.MissingAccountNameFlag.code);
        });

        it('should fail - cli account delete - root account has IAM accounts', async function() {
            const { name, type } = defaults;
            const accounts_details = await config_fs.get_account_by_name(name, config_fs_account_options);
            const account_id = accounts_details._id;

            const account_name = 'account-to-be-owned';
            const account_options1 = { config_root, name: account_name, uid: 5555, gid: 5555 };
            await exec_manage_cli(type, ACTIONS.ADD, account_options1);

            // update the account to have the property owner
            // (we use this way because now we don't have the way to create IAM users through the noobaa cli)
            const config_data = await config_fs.get_account_by_name(account_name, config_fs_account_options);
            config_data.owner = account_id; // just so we can identify this account as IAM user;
            await config_fs.update_account_config_file(config_data);
            const action = ACTIONS.DELETE;
            const account_options2 = { config_root, name };
            const res = await exec_manage_cli(type, action, account_options2);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.AccountDeleteForbiddenHasIAMAccounts.code);
        });

        it('should fail when deleting anonymous account with option (name), and succeed with option (anonymous)', async function() {
            const { type } = defaults;
            const user = 'test-user';
            const account_options1 = { user: user };
            const command = create_command(type, ACTIONS.ADD, account_options1);
            const flag = ANONYMOUS;
            await exec_manage_cli_add_empty_option(command, flag);

            const account_options2 = { name: ANONYMOUS };
            const res = await exec_manage_cli(type, ACTIONS.DELETE, account_options2);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.InvalidAccountName.message);

            const command2 = create_command(type, ACTIONS.DELETE);
            const res2 = await exec_manage_cli_add_empty_option(command2, flag);
            const res_json = JSON.parse(res2.trim());
            expect(res_json.response.code).toBe(ManageCLIResponse.AccountDeleted.code);
        });

    });

    describe('cli status account', () => {
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs5');
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs5/');
        const type = TYPES.ACCOUNT;
        const defaults = {
            name: 'account22',
            new_buckets_path: `${root_path}new_buckets_path_user22/`,
            uid: 1022,
            gid: 1022,
            access_key: 'GIGiFAnjaaE7OKD5N722',
            secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+22EXAMPLE',
        };

        beforeEach(async () => {
            await fs_utils.create_fresh_path(root_path);
            set_nc_config_dir_in_config(config_root);
            const action = ACTIONS.ADD;
            const { new_buckets_path } = defaults;
            const account_options = { config_root, ...defaults };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, account_options, 0o700);
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

    describe('cli create account using from_file', () => {
        const type = TYPES.ACCOUNT;
        const config_root = path.join(tmp_fs_path, 'config_root_manage_nsfs6');
        const config_fs = new ConfigFS(config_root);
        const root_path = path.join(tmp_fs_path, 'root_path_manage_nsfs6/');

        const path_to_json_account_options_dir = path.join(tmp_fs_path, 'options');
        const defaults = {
            name: 'account3',
            new_buckets_path: `${root_path}new_buckets_path_user33/`,
            uid: 1003,
            gid: 1003,
            access_key: 'GIGiFAnjaaE7OKD5N722',
            secret_key: 'U2AYaMpU3zRDcRFWmvzgQr9MoHIAsD+22EXAMPLE',
        };

        beforeEach(async () => {
            set_nc_config_dir_in_config(config_root);
            await fs_utils.create_fresh_path(root_path);
            await fs_utils.create_fresh_path(path_to_json_account_options_dir);
            // create the new_buckets_path and set permissions
            const { new_buckets_path, uid, gid } = defaults;
            const owner_options = { uid, gid };
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await set_path_permissions_and_owner(new_buckets_path, owner_options, 0o700);
        });

        afterEach(async () => {
            await fs_utils.folder_delete(`${config_root}`);
            await fs_utils.folder_delete(`${root_path}`);
            await fs_utils.folder_delete(`${path_to_json_account_options_dir}`);
        });

        it('cli create account using from_file with required options (uid, gid)', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid, gid } = defaults;
            const account_options = { name, new_buckets_path, uid, gid };
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account and check the details
            await exec_manage_cli(type, action, command_flags);
            // compare the details
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, false);
        });

        it('cli create account using from_file with access_key and secret_key', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid, gid, access_key, secret_key } = defaults;
            const account_options = { name, new_buckets_path, uid, gid, access_key, secret_key};
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account and check the details
            await exec_manage_cli(type, action, command_flags);
            // compare the details
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            assert_account(account, account_options, true);
            expect(account.access_keys[0].access_key).toBe(access_key);
            expect(account.access_keys[0].secret_key).toBe(secret_key);
        });

        it('should fail - cli create account using from_file with invalid access_key and secret_key', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid, gid } = defaults;
            const access_key = 'abc'; // invalid access_key
            const secret_key = '123'; // invalid secret_key
            const account_options = { name, new_buckets_path, uid, gid, access_key, secret_key};
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountAccessKeyFlag.code);
        });

        it('should fail - cli create account using from_file with additional flags (name)', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid, gid } = defaults;
            const account_options = { name, new_buckets_path, uid, gid };
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name, name }; // name should be in file only
            // create the account
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create account using from_file with invalid option (lala) in the file', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid, gid } = defaults;
            const account_options = { name, new_buckets_path, uid, gid, lala: 'lala'}; // lala invalid option
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create account using from_file with invalid option (creation_date) in the file', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid, gid } = defaults;
            const account_options = { name, new_buckets_path, uid, gid, creation_date: new Date().toISOString()}; // creation_date invalid option (user cannot set it)
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create account using from_file with from_file inside the JSON file', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid, gid } = defaults;
            const account_options = { name, new_buckets_path, uid, gid, from_file: 'blabla' }; //from_file inside options JSON file
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgument.code);
        });

        it('should fail - cli create account using from_file with invalid option type (in the file)', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid } = defaults;
            const account_options = { name, new_buckets_path, uid, gid: 'lala'}; // gid should be number (not string)
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidArgumentType.code);
        });

        it('should fail - cli create account using from_file with invalid path', async () => {
            const action = ACTIONS.ADD;
            const command_flags = {config_root, from_file: 'blabla'}; //invalid path 
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidFilePath.code);
        });

        it('should fail - cli create account using from_file with invalid JSON file', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid, gid } = defaults;
            const account_options = { name, new_buckets_path, uid, gid };
            // write invalid json_file_options
            const option_json_file_name = `${account_options.name}_options.json`;
            const path_to_option_json_file_name = path.join(path_to_json_account_options_dir, option_json_file_name);
            const content = JSON.stringify(account_options) + 'blabla'; // invalid JSON
            await fs.promises.writeFile(path_to_option_json_file_name, content);
            // write the json_file_options
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account
            await exec_manage_cli(type, action, command_flags);
            // compare the details
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidJSONFile.code);
        });

        it('should fail - cli create account using from_file with invalid option combination (in the file uid and user)', async () => {
            const action = ACTIONS.ADD;
            const { name, uid } = defaults;
            const account_options = { name, uid, user: 'root'}; // no need user and uid
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidFlagsCombination.code);
        });

        it('should fail - cli create account using from_file with invalid option combination (in the file gid and user)', async () => {
            const action = ACTIONS.ADD;
            const { name, gid } = defaults;
            const account_options = { name, gid, user: 'root'}; // no need user and gid
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidFlagsCombination.code);
        });

        it('should fail - cli create account using from_file with invalid option combination (in the file uid, gid and user)', async () => {
            const action = ACTIONS.ADD;
            const { name, uid, gid } = defaults;
            const account_options = { name, uid, gid, user: 'root'}; // no need user and gid
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidFlagsCombination.code);
        });

        it('should fail - cli create account using from_file with invalid name (anonymous)', async () => {
            const action = ACTIONS.ADD;
            const { uid, gid } = defaults;
            const account_options = { name: 'anonymous', uid, gid}; // invalid name (anonymous)
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountName.code);
        });

        it('should fail - cli create account using from_file with invalid name (more than max length)', async () => {
            const action = ACTIONS.ADD;
            const { uid, gid } = defaults;
            const account_options = { name: 'A'.repeat(100), uid, gid}; // name (too long)
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountName.code);
        });

        it('cli create account using from_file with supplemental_groups', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid, gid } = defaults;
            const supplemental_groups = [212, 112];
            const account_options = { name, new_buckets_path, uid, gid, supplemental_groups };
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account and check the details
            await exec_manage_cli(type, action, command_flags);
            // compare the details
            const account = await config_fs.get_account_by_name(name, config_fs_account_options);
            expect(account.nsfs_account_config.supplemental_groups).toStrictEqual(supplemental_groups);
        });

        it('should fail - cli create account using from_file with invalid supplemental_groups (negative number)', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid, gid } = defaults;
            const supplemental_groups = [212, -112]; // gid cannot be negative number
            const account_options = { name, new_buckets_path, uid, gid, supplemental_groups };
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account and check the details
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidSupplementalGroupsList.code);
        });

        it('should fail - cli create account using from_file with invalid supplemental_groups (string)', async () => {
            const action = ACTIONS.ADD;
            const { name, new_buckets_path, uid, gid } = defaults;
            const supplemental_groups = ['212d', 112]; // gid cannot a non number type
            const account_options = { name, new_buckets_path, uid, gid, supplemental_groups };
            // write the json_file_options
            const path_to_option_json_file_name = await create_json_account_options(path_to_json_account_options_dir, account_options);
            const command_flags = {config_root, from_file: path_to_option_json_file_name};
            // create the account and check the details
            const res = await exec_manage_cli(type, action, command_flags);
            expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidSupplementalGroupsList.code);
        });
    });

});


describe('cli account flow distinguished_name - permissions', function() {
    const type = TYPES.ACCOUNT;
    const config_root = path.join(tmp_fs_path, 'config_root_manage_dn');
    const config_fs = new ConfigFS(config_root);
    const new_buckets_path = path.join(tmp_fs_path, 'new_buckets_path_user_dn_test/');

    const accounts = {
        root: {
            cli_options: {
                config_root,
                name: 'rooti',
                new_buckets_path,
                user: 'root',
            }
        },
        non_existing_dn: {
            cli_options: {
                config_root,
                name: 'account_dn1',
                new_buckets_path,
                user: 'moti1003'
            }
        },
        accessible_user: {
            cli_options: {
                config_root,
                new_buckets_path,
                name: 'accessible_user',
                user: 'accessible_user',
            },
            fs_options: {
                distinguished_name: 'accessible_user',
                pass: 'newpass',
                uid: 555,
                gid: 555
            }
        },
        inaccessible_user: {
            cli_options: {
                config_root,
                new_buckets_path,
                name: 'inaccessible_user',
                user: 'inaccessible_user',
            },
            fs_options: {
                distinguished_name: 'inaccessible_user',
                pass: 'newpass',
                uid: 1111,
                gid: 1111
            }
        }
    };

    beforeAll(async () => {
        set_nc_config_dir_in_config(config_root);
        await fs_utils.create_fresh_path(config_root);
        await fs_utils.file_must_exist(config_root);
        for (const account of Object.values(accounts)) {
            if (!account.fs_options) continue;
            const { distinguished_name, pass, uid, gid } = account.fs_options;
            await create_fs_user_by_platform(distinguished_name, pass, uid, gid);
        }
        await fs_utils.create_fresh_path(new_buckets_path);
        await fs_utils.file_must_exist(new_buckets_path);
        await set_path_permissions_and_owner(new_buckets_path, { uid: 0, gid: 0 }, 0o700);
        const res = await exec_manage_cli(type, ACTIONS.ADD, accounts.root.cli_options);
        assert_account(JSON.parse(res).response.reply, accounts.root.cli_options, false);
    }, timeout);

    afterAll(async () => {
        await exec_manage_cli(type, ACTIONS.DELETE, { name: accounts.accessible_user.cli_options.name, config_root });
        await exec_manage_cli(type, ACTIONS.DELETE, { name: accounts.root.cli_options.name, config_root });
        for (const account of Object.values(accounts)) {
            if (!account.fs_options) continue;
            const { distinguished_name } = account.fs_options;
            await delete_fs_user_by_platform(distinguished_name);
        }
        await fs_utils.folder_delete(config_root);
    }, timeout);

    it('cli account create - should fail - user does not exist', async function() {
        const action = ACTIONS.ADD;
        const res = await exec_manage_cli(type, action, accounts.non_existing_dn.cli_options);
        expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountDistinguishedName.code);
    }, timeout);

    it('cli account update distinguished_name - should fail - user does not exist', async function() {
        const action = ACTIONS.UPDATE;
        const update_options = {
            config_root,
            name: accounts.root.cli_options.name,
            user: 'moti1004',
        };
        const res = await exec_manage_cli(type, action, update_options);
        expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InvalidAccountDistinguishedName.code);
    }, timeout);

    it('cli account create - should fail - account cant access new_bucket_path', async function() {
        const action = ACTIONS.ADD;
        const res = await exec_manage_cli(type, action, accounts.inaccessible_user.cli_options);
        expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InaccessibleAccountNewBucketsPath.code);
    }, timeout);

    it('cli account update distinguished_name - should fail - not owner - account cant access new_bucket_path', async function() {
        const action = ACTIONS.UPDATE;
        const update_options = {
            config_root,
            name: accounts.root.cli_options.name,
            user: accounts.inaccessible_user.fs_options.distinguished_name,
        };
        const res = await exec_manage_cli(type, action, update_options);
        expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InaccessibleAccountNewBucketsPath.code);
    }, timeout);

    it('cli account create - valid and accessible distinguished name', async function() {
        await fs.promises.chown(new_buckets_path, accounts.accessible_user.fs_options.uid, accounts.accessible_user.fs_options.gid);
        const action = ACTIONS.ADD;
        const res = await exec_manage_cli(type, action, accounts.accessible_user.cli_options);
        assert_account(JSON.parse(res).response.reply, accounts.accessible_user.cli_options, false);
    }, timeout);

    it('cli account update root - other valid and accessible distinguished_name', async function() {
        const action = ACTIONS.UPDATE;
        const update_options = {
            config_root,
            name: accounts.root.cli_options.name,
            user: accounts.accessible_user.fs_options.distinguished_name,
        };
        const res = await exec_manage_cli(type, action, update_options);
        assert_account(JSON.parse(res).response.reply, { ...accounts.root.cli_options, ...update_options }, false);
    }, timeout);

    it('cli account update - should fail - no permissions to new_buckets_path', async function() {
        const no_permissions_new_buckets_path = `${tmp_fs_path}/new_buckets_path_no_perm_to_owner1/`;
        await fs_utils.create_fresh_path(no_permissions_new_buckets_path);
        await fs_utils.file_must_exist(no_permissions_new_buckets_path);
        await set_path_permissions_and_owner(no_permissions_new_buckets_path, accounts.accessible_user.fs_options, 0o000);
        const action = ACTIONS.UPDATE;
        const update_options = {
            config_root,
            ...accounts.accessible_user.cli_options,
            new_buckets_path: no_permissions_new_buckets_path,
        };
        const res = await exec_manage_cli(type, action, update_options);
        expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InaccessibleAccountNewBucketsPath.code);
    }, timeout);

    it('cli account update - should fail - posix mode write permissions of new_buckets_path', async function() {
        const no_permissions_new_buckets_path = `${tmp_fs_path}/new_buckets_path_no_r_perm_to_owner/`;
        await fs_utils.create_fresh_path(no_permissions_new_buckets_path);
        await fs_utils.file_must_exist(no_permissions_new_buckets_path);
        await set_path_permissions_and_owner(no_permissions_new_buckets_path, accounts.accessible_user.fs_options, 0o477);
        const action = ACTIONS.UPDATE;
        const update_options = {
            config_root,
            ...accounts.accessible_user.cli_options,
            new_buckets_path: no_permissions_new_buckets_path,
        };
        await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_POSIX_MODE_ACCESS_CHECK: false }));
        const res = await exec_manage_cli(type, action, update_options);
        await config_fs.delete_config_json_file();
        expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InaccessibleAccountNewBucketsPath.code);
    }, timeout);

    it('cli account update - should fail - no read permissions of new_buckets_path', async function() {
        const no_permissions_new_buckets_path = `${tmp_fs_path}/new_buckets_path_no_w_perm_to_owner/`;
        await fs_utils.create_fresh_path(no_permissions_new_buckets_path);
        await fs_utils.file_must_exist(no_permissions_new_buckets_path);
        await set_path_permissions_and_owner(no_permissions_new_buckets_path, accounts.accessible_user.fs_options, 0o000);
        const action = ACTIONS.UPDATE;
        const update_options = {
            config_root,
            ...accounts.accessible_user.cli_options,
            new_buckets_path: no_permissions_new_buckets_path,
        };
        const res = await exec_manage_cli(type, action, update_options);
        expect(JSON.parse(res.stdout).error.code).toBe(ManageCLIError.InaccessibleAccountNewBucketsPath.code);
    });

    it('cli account update - should succeed - no read permissions of new_buckets_path - NC_DISABLE_ACCESS_CHECK: true', async function() {
        const no_permissions_new_buckets_path = `${tmp_fs_path}/new_buckets_path_no_w_perm_to_owner/`;
        await fs_utils.create_fresh_path(no_permissions_new_buckets_path);
        await fs_utils.file_must_exist(no_permissions_new_buckets_path);

        await set_path_permissions_and_owner(no_permissions_new_buckets_path, accounts.accessible_user.fs_options, 0o000);
        const action = ACTIONS.UPDATE;
        const update_options = {
            config_root,
            ...accounts.accessible_user.cli_options,
            new_buckets_path: no_permissions_new_buckets_path,
        };
        await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
        const res = await exec_manage_cli(type, action, update_options);
        await config_fs.delete_config_json_file();
        assert_account(JSON.parse(res).response.reply, update_options, false);
    });

    it('cli account create - account cant access new_bucket_path - NC_DISABLE_ACCESS_CHECK = true', async function() {
        let action = ACTIONS.ADD;
        config.NC_DISABLE_ACCESS_CHECK = true;
        set_nc_config_dir_in_config(config_root);
        await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
        const res = await exec_manage_cli(type, action, accounts.inaccessible_user.cli_options);
        await config_fs.delete_config_json_file();
        expect(JSON.parse(res).response.code).toEqual(ManageCLIResponse.AccountCreated.code);
        assert_account(JSON.parse(res).response.reply, { ...accounts.inaccessible_user.cli_options }, false);
        action = ACTIONS.DELETE;
        const delete_inaccessible_options = _.omit(accounts.inaccessible_user.cli_options, ['new_buckets_path', 'user']);
        await exec_manage_cli(type, action, delete_inaccessible_options);
        config.NC_DISABLE_ACCESS_CHECK = false;
    }, timeout);
});


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
 * exec_manage_cli_add_leading_space_option modifies the command by appending a flag with a value(quoted or non-quoted) that includes a leading space to test CLI parsing behavior
 * @param {string} command
 * @param {string} option
 * @param {string} value
 * @param {"s" | "qs" | "sq" | "default"} quoted
 *
 * @examples
 * - await exec_manage_cli_add_leading_space_option("cli_command", "flag", "val", quoted_type.SPACE_ONLY);
 *   // cli_command --flag= val  (Space before value)
 *
 * - await exec_manage_cli_add_leading_space_option("cli_command", "flag", "val", quoted_type.QUOTE_SPACE);
 *   // cli_command --flag=" val"  (quote then space)
 *
 * - await exec_manage_cli_add_leading_space_option("cli_command", "flag", "val", quoted_type.SPACE_QUOTE);
 *   // cli_command --flag= "val"  (space then quote)
 *
 * - await exec_manage_cli_add_leading_space_option("cli_command", "flag", "val");
 *   // cli_command --flag=val  (No special formatting)
 */
async function exec_manage_cli_add_leading_space_option(command, option, value, quoted = "default") {
    let changed_command;

    switch (quoted) {
        case quoted_type.SPACE_ONLY:
            changed_command = `${command} --${option}= ${value}`;
            break;
        case quoted_type.QUOTE_SPACE:
            changed_command = `${command} --${option}=" ${value}"`;
            break;
        case quoted_type.SPACE_QUOTE:
            changed_command = `${command} --${option}= "${value}"`;
            break;
        default:
            changed_command = `${command} --${option}=${value}`;
    }

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

/** 
 * create_json_account_options would create a JSON file with the options (key-value) inside file
 * @param {string} path_to_json_account_options_dir
 * @param {object} account_options
 */
async function create_json_account_options(path_to_json_account_options_dir, account_options) {
    const option_json_file_name = `${account_options.name}_options.json`;
    const path_to_option_json_file_name = path.join(path_to_json_account_options_dir, option_json_file_name);
    const content = JSON.stringify(account_options);
    await fs.promises.writeFile(path_to_option_json_file_name, content);
    return path_to_option_json_file_name;
}
