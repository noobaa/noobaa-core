/* Copyright (C) 2024 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

/*
 * This file is written as a part of TDD (Test Driven Development)
 * The asserts reflects the current state of implementation (not final)
 */

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const nb_native = require('../../../util/nb_native');
const SensitiveString = require('../../../util/sensitive_string');
const AccountSpaceFS = require('../../../sdk/accountspace_fs');
const { TMP_PATH } = require('../../system_tests/test_utils');
const { get_process_fs_context } = require('../../../util/native_fs_utils');
const { IAM_DEFAULT_PATH, ACCESS_KEY_STATUS_ENUM } = require('../../../endpoint/iam/iam_constants');
const fs_utils = require('../../../util/fs_utils');
const { IamError } = require('../../../endpoint/iam/iam_errors');
const nc_mkm = require('../../../manage_nsfs/nc_master_key_manager').get_instance();
const native_fs_utils = require('../../../util/native_fs_utils');
const nsfs_schema_utils = require('../../../manage_nsfs/nsfs_schema_utils');

class NoErrorThrownError extends Error {}

const DEFAULT_FS_CONFIG = get_process_fs_context();
const tmp_fs_path = path.join(TMP_PATH, 'test_accountspace_fs');
const config_root = path.join(tmp_fs_path, 'config_root');
const new_buckets_path1 = path.join(tmp_fs_path, 'new_buckets_path1', '/');
const new_buckets_path2 = path.join(tmp_fs_path, 'new_buckets_path2', '/');
const new_buckets_path3 = path.join(tmp_fs_path, 'new_buckets_path3', '/');

const accountspace_fs = new AccountSpaceFS({ config_root });

const root_user_account = {
    _id: '65a8edc9bc5d5bbf9db71b91',
    name: 'test-root-account-1001',
    email: 'test-root-account-1001',
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-abcdefghijklmn123456',
        secret_key: 's-abcdefghijklmn123456EXAMPLE'
    }],
    nsfs_account_config: {
        uid: 1001,
        gid: 1001,
        new_buckets_path: new_buckets_path1,
    },
    creation_date: '2023-10-30T04:46:33.815Z',
    master_key_id: '65a62e22ceae5e5f1a758123',
};

const root_user_account2 = {
    _id: '65a8edc9bc5d5bbf9db71b92',
    name: 'test-root-account-1002',
    email: 'test-root-account-1002',
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-bbcdefghijklmn123456',
        secret_key: 's-bbcdefghijklmn123456EXAMPLE'
    }],
    nsfs_account_config: {
        uid: 1002,
        gid: 1002,
        new_buckets_path: new_buckets_path2,
    },
    creation_date: '2023-11-30T04:46:33.815Z',
    master_key_id: '65a62e22ceae5e5f1a758123',
};

const root_user_root_accounts_manager = {
    _id: '65a8edc9bc5d5bbf9db71b93',
    name: 'test-root-accounts-manager-1003',
    email: 'test-root-accounts-manager-1003',
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-cccdefghijklmn123456',
        secret_key: 's-cccdefghijklmn123456EXAMPLE'
    }],
    nsfs_account_config: {
        uid: 1003,
        gid: 1003,
        new_buckets_path: new_buckets_path3,
    },
    creation_date: '2023-10-30T04:46:33.815Z',
    master_key_id: '65a62e22ceae5e5f1a758123',
    iam_operate_on_root_account: true,
};

// I'm only interested in the requesting_account field
function make_dummy_account_sdk(root_account = root_user_account) {
    return {
            requesting_account: {
                _id: root_account._id,
                name: new SensitiveString(root_account.name),
                email: new SensitiveString(root_account.email),
                creation_date: root_account.creation_date,
                access_keys: [{
                    access_key: new SensitiveString(root_account.access_keys[0].access_key),
                    secret_key: new SensitiveString(root_account.access_keys[0].secret_key)
                }],
                nsfs_account_config: root_account.nsfs_account_config,
                allow_bucket_creation: root_account.allow_bucket_creation,
                master_key_id: root_account.master_key_id,
            },
    };
}

function make_dummy_account_sdk_non_root_user() {
    const account_sdk = _.cloneDeep(make_dummy_account_sdk());
    account_sdk.requesting_account.owner = '65a8edc9bc5d5bbf9db71b92';
    account_sdk.requesting_account.name = new SensitiveString('test-not-root-account-1001');
    account_sdk.requesting_account.email = new SensitiveString('test-not-root-account-1001');
    return account_sdk;
}

function make_dummy_account_sdk_created_from_another_account(account, root_account_id) {
    return {
        requesting_account: {
            _id: account._id,
            name: new SensitiveString(account.name),
            email: new SensitiveString(account.email),
            creation_date: account.creation_date,
            access_keys: [{
                access_key: new SensitiveString(account.access_keys[0].access_key),
                secret_key: new SensitiveString(account.access_keys[0].secret_key)
            }],
            nsfs_account_config: account.nsfs_account_config,
            allow_bucket_creation: account.allow_bucket_creation,
            master_key_id: account.master_key_id,
            owner: root_account_id,
            creator: root_account_id,
        },
    };
}

function make_dummy_account_sdk_from_root_accounts_manager(account, root_account_manager_id) {
    const dummy_account_sdk = make_dummy_account_sdk_created_from_another_account(account, root_account_manager_id);
    delete dummy_account_sdk.requesting_account.owner;
    return dummy_account_sdk;
}

// use it for root user that doesn't create the resources
// (only tries to get, update and delete resources that it doesn't own)
function make_dummy_account_sdk_not_for_creating_resources() {
    return {
            requesting_account: {
                _id: root_user_account2._id,
                name: new SensitiveString(root_user_account2.name),
                email: new SensitiveString(root_user_account2.email),
                creation_date: root_user_account2.creation_date,
                access_keys: [{
                    access_key: new SensitiveString(root_user_account2.access_keys[0].access_key),
                    secret_key: new SensitiveString(root_user_account2.access_keys[0].secret_key)
                }],
                nsfs_account_config: root_user_account2.nsfs_account_config,
                allow_bucket_creation: root_user_account2.allow_bucket_creation,
                master_key_id: root_user_account2.master_key_id,
            },
    };
}

// I'm only interested in the requesting_account field
function make_dummy_account_sdk_root_accounts_manager() {
    return {
            requesting_account: {
                _id: root_user_root_accounts_manager._id,
                name: new SensitiveString(root_user_root_accounts_manager.name),
                email: new SensitiveString(root_user_root_accounts_manager.email),
                creation_date: root_user_root_accounts_manager.creation_date,
                access_keys: [{
                    access_key: new SensitiveString(root_user_root_accounts_manager.access_keys[0].access_key),
                    secret_key: new SensitiveString(root_user_root_accounts_manager.access_keys[0].secret_key)
                }],
                nsfs_account_config: root_user_root_accounts_manager.nsfs_account_config,
                allow_bucket_creation: root_user_root_accounts_manager.allow_bucket_creation,
                iam_operate_on_root_account: root_user_root_accounts_manager.iam_operate_on_root_account,
                master_key_id: root_user_root_accounts_manager.master_key_id,
            },
    };
}

describe('Accountspace_FS tests', () => {

    beforeAll(async () => {
        await fs_utils.create_fresh_path(accountspace_fs.accounts_dir);
        await fs_utils.create_fresh_path(accountspace_fs.root_accounts_dir);
        await fs_utils.create_fresh_path(accountspace_fs.access_keys_dir);
        await fs_utils.create_fresh_path(accountspace_fs.buckets_dir);
        await fs_utils.create_fresh_path(new_buckets_path1);
        await fs_utils.create_fresh_path(new_buckets_path3);
        await fs.promises.chown(new_buckets_path1,
            root_user_account.nsfs_account_config.uid, root_user_account.nsfs_account_config.gid);
        await fs.promises.chown(new_buckets_path3,
            root_user_root_accounts_manager.nsfs_account_config.uid, root_user_root_accounts_manager.nsfs_account_config.gid);

        for (const account of [root_user_account, root_user_account2, root_user_root_accounts_manager]) {
            const account_path = accountspace_fs._get_account_config_path(account._id);
            // assuming that the root account has only 1 access key in the 0 index
            const account_access_path = accountspace_fs._get_access_keys_config_path(account.access_keys[0].access_key);
            await fs.promises.writeFile(account_path, JSON.stringify(account));
            await fs.promises.chmod(account_path, 0o600);
            await fs.promises.symlink(account_path, account_access_path);
            await fs_utils.create_fresh_path(path.join(accountspace_fs.root_accounts_dir, account.name));
            const root_account_path = await accountspace_fs._get_account_config_path_by_root_name(account.name, account.name);
            await fs.promises.symlink(account_path, root_account_path);
        }
    });
    afterAll(async () => {
        fs_utils.folder_delete(config_root);
        fs_utils.folder_delete(new_buckets_path1);
    });

    describe('Accountspace_FS Users tests', () => {
        const dummy_iam_path = '/division_abc/subdivision_xyz/';
        const dummy_iam_path2 = '/division_def/subdivision_uvw/';
        const dummy_username1 = 'Bob';
        const dummy_username2 = 'Robert';
        const dummy_username3 = 'Alice';
        const dummy_username4 = 'James';
        const dummy_username5 = 'Henry';
        const dummy_username6 = 'Mary';
        const dummy_username7 = 'Susan';
        const dummy_username8 = 'Lisa';
        const dummy_username9 = 'Thomas';
        const dummy_username10 = 'Mark';
        const dummy_user1 = {
            username: dummy_username1,
            iam_path: dummy_iam_path,
        };
        const dummy_user2 = {
            username: dummy_username2,
            iam_path: dummy_iam_path,
        };
        const dummy_user_root_account = {
            username: dummy_username5,
        };

        describe('create_user', () => {
            it('create_user should return user params (requesting account is root account to create IAM user)', async function() {
                const params = {
                    username: dummy_user1.username,
                    iam_path: dummy_user1.iam_path,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.create_user(params, account_sdk);
                expect(res.iam_path).toBe(params.iam_path);
                expect(res.username).toBe(params.username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                expect(res.create_date).toBeDefined();

                const iam_user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    params.username, true);
                expect(iam_user_account_config_file.name).toBe(params.username);
                expect(iam_user_account_config_file._id).toBe(res.user_id);
                expect(iam_user_account_config_file.creation_date).toBeDefined();
                expect(iam_user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(iam_user_account_config_file.access_keys)).toBe(true);
                expect(iam_user_account_config_file.access_keys.length).toBe(0);

                const user_account_config_file = await read_config_file(accountspace_fs.accounts_dir, res.user_id, false);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file._id).toBe(res.user_id);
                expect(user_account_config_file.creation_date).toBeDefined();
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(0);
                expect(user_account_config_file.owner).toBe(account_sdk.requesting_account._id);
                expect(user_account_config_file.creator).toBe(account_sdk.requesting_account._id);
            });

            it('create_user should return user params (requesting account is root accounts manager - has allow_bucket_creation true with new_buckets_path - to create root account user)', async function() {
                const params = {
                    username: dummy_user_root_account.username,
                };
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                const res = await accountspace_fs.create_user(params, account_sdk);
                expect(res.iam_path).toBe(IAM_DEFAULT_PATH);
                expect(res.username).toBe(params.username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                expect(res.create_date).toBeDefined();

                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, dummy_user_root_account.username),
                    params.username, true);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file._id).toBeDefined();
                expect(user_account_config_file.creation_date).toBeDefined();
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(0);
                expect(user_account_config_file.allow_bucket_creation).toBe(true);
                expect(user_account_config_file.iam_operate_on_root_account).toBeUndefined();
                expect(user_account_config_file.owner).toBeUndefined();
                expect(user_account_config_file.creator).toBe(account_sdk.requesting_account._id);
            });

            it('create_user should return user params (requesting account is root accounts manager - has allow_bucket_creation false with new_buckets_path - to create root account user)', async function() {
                const params = {
                    username: dummy_username9,
                };
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                // manipulate the allow_bucket_creation to false
                const account_sdk_copy = _.cloneDeep(account_sdk);
                account_sdk_copy.requesting_account.allow_bucket_creation = false;

                const res = await accountspace_fs.create_user(params, account_sdk_copy);
                expect(res.iam_path).toBe(IAM_DEFAULT_PATH);
                expect(res.username).toBe(params.username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                expect(res.create_date).toBeDefined();

                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, dummy_username9),
                    params.username, true);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file._id).toBeDefined();
                expect(user_account_config_file.creation_date).toBeDefined();
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(0);
                expect(user_account_config_file.allow_bucket_creation).toBe(true);
                expect(user_account_config_file.iam_operate_on_root_account).toBeUndefined();
                expect(user_account_config_file.owner).toBeUndefined();
                expect(user_account_config_file.creator).toBe(account_sdk.requesting_account._id);
            });

            it('create_user should return user params (requesting account is root accounts manager - has allow_bucket_creation false without new_buckets_path - to create root account user)', async function() {
                const params = {
                    username: dummy_username10,
                };
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                // manipulate the allow_bucket_creation to false, remove new_buckets_path
                const account_sdk_copy = _.cloneDeep(account_sdk);
                account_sdk_copy.requesting_account.allow_bucket_creation = false;
                delete account_sdk_copy.requesting_account.nsfs_account_config.new_buckets_path;

                const res = await accountspace_fs.create_user(params, account_sdk_copy);
                expect(res.iam_path).toBe(IAM_DEFAULT_PATH);
                expect(res.username).toBe(params.username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                expect(res.create_date).toBeDefined();

                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, dummy_username10),
                    params.username, true);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file._id).toBeDefined();
                expect(user_account_config_file.creation_date).toBeDefined();
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(0);
                expect(user_account_config_file.allow_bucket_creation).toBe(false);
                expect(user_account_config_file.iam_operate_on_root_account).toBeUndefined();
                expect(user_account_config_file.owner).toBeUndefined();
                expect(user_account_config_file.creator).toBe(account_sdk.requesting_account._id);
            });

            it('create_user should return an error if requesting user is not a root account user', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                        iam_path: dummy_user1.iam_path,
                    };
                    const account_sdk = make_dummy_account_sdk_non_root_user();
                    await accountspace_fs.create_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });

            it('create_user should return an error if username already exists', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                        iam_path: dummy_user1.iam_path,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.create_user(params, account_sdk);
                    // now username already exists
                    await accountspace_fs.create_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.EntityAlreadyExists.code);
                }
            });
        });

        describe('get_user', () => {
            it('get_user should return user params (requesting account is root account to create IAM user)', async function() {
                const params = {
                    username: dummy_user1.username,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.get_user(params, account_sdk);
                expect(res.user_id).toBeDefined();
                expect(res.iam_path).toBe(dummy_user1.iam_path);
                expect(res.username).toBe(dummy_user1.username);
                expect(res.arn).toBeDefined();
                expect(res.create_date).toBeDefined();
                expect(res.password_last_used).toBeDefined();
            });

            it('get_user should return user params (requesting account is root accounts manager to create root account user)', async function() {
                const params = {
                    username: dummy_user_root_account.username,
                };
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                const res = await accountspace_fs.get_user(params, account_sdk);
                expect(res.user_id).toBeDefined();
                expect(res.iam_path).toBe(IAM_DEFAULT_PATH);
                expect(res.username).toBe(dummy_user_root_account.username);
                expect(res.arn).toBeDefined();
                expect(res.create_date).toBeDefined();
                expect(res.password_last_used).toBeDefined();
            });

            it('get_user should return an error if requesting user is not a root account user', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                    };
                    const account_sdk = make_dummy_account_sdk_non_root_user();
                    await accountspace_fs.get_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });

            it('get_user should return an error if user to get is a root account user', async function() {
                try {
                    const params = {
                        username: root_user_root_accounts_manager.name,
                    };
                    const account_sdk = make_dummy_account_sdk(root_user_root_accounts_manager);
                    await accountspace_fs.get_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('get_user should return an error if user account does not exist', async function() {
                try {
                    const params = {
                        username: 'non-existing-user',
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.get_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('get_user should return an error if user is not owned by the root account', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                    };
                    const account_sdk = make_dummy_account_sdk_not_for_creating_resources();
                    await accountspace_fs.get_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('get_user should return user params (user has access_keys)', async function() {
                const account_sdk = make_dummy_account_sdk();
                // create the user
                let params = {
                    username: dummy_username4,
                };
                await accountspace_fs.create_user(params, account_sdk);
                // create the access key
                params = {
                    username: dummy_username4,
                };
                await accountspace_fs.create_access_key(params, account_sdk);
                // get the user
                params = {
                    username: dummy_username4,
                };
                const res = await accountspace_fs.get_user(params, account_sdk);
                expect(res.user_id).toBeDefined();
                expect(res.iam_path).toBe(IAM_DEFAULT_PATH);
                expect(res.username).toBe(dummy_username4);
                expect(res.arn).toBeDefined();
                expect(res.create_date).toBeDefined();
                expect(res.password_last_used).toBeDefined();
            });
        });

        describe('update_user', () => {

            it('update_user without actual property to update should return user params', async function() {
                const params = {
                    username: dummy_user1.username,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.update_user(params, account_sdk);
                expect(res.iam_path).toBe(dummy_user1.iam_path);
                expect(res.username).toBe(dummy_user1.username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();

                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    params.username, true);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.iam_path).toBe(dummy_user1.iam_path);
            });

            it('update_user with new_iam_path should return user params and update the iam_path (requesting account is root account to create IAM user)', async function() {
                let params = {
                    username: dummy_user1.username,
                    new_iam_path: dummy_iam_path2,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.update_user(params, account_sdk);
                expect(res.iam_path).toBe(dummy_iam_path2);
                expect(res.username).toBe(dummy_user1.username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    params.username, true);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.iam_path).toBe(dummy_iam_path2);
                // back as it was
                params = {
                    username: dummy_user1.username,
                    new_iam_path: dummy_user1.iam_path,
                };
                await accountspace_fs.update_user(params, account_sdk);
            });

            it('update_user with new_iam_path should return user params and update the iam_path (requesting account is root accounts manager to create root account user)', async function() {
                const params = {
                    username: dummy_user_root_account.username,
                    new_iam_path: dummy_iam_path,
                };
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                const res = await accountspace_fs.update_user(params, account_sdk);
                expect(res.iam_path).toBe(dummy_iam_path);
                expect(res.username).toBe(dummy_user_root_account.username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, dummy_user_root_account.username),
                    params.username, true);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.iam_path).toBe(dummy_iam_path);
            });

            it('update_user should return an error if requesting user is not a root account user', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                    };
                    const account_sdk = make_dummy_account_sdk_non_root_user();
                    await accountspace_fs.update_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });

            it('update_user should return an error if user to update is a root account user', async function() {
                try {
                    const params = {
                        username: root_user_root_accounts_manager.name,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.update_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('update_user should return an error if user account does not exist', async function() {
                try {
                    const params = {
                        username: 'non-existing-user',
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.update_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('update_user should return an error if user is not owned by the root account', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                    };
                    const account_sdk = make_dummy_account_sdk_not_for_creating_resources();
                    await accountspace_fs.update_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('update_user2 with new_username should return an error if username already exists', async function() {
                try {
                    let params = {
                        username: dummy_user2.username,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    // create user2
                    await accountspace_fs.create_user(params, account_sdk);
                    params = {
                        username: dummy_user2.username,
                        new_username: dummy_user1.username,
                    };
                    // update user2 with username of user1
                    await accountspace_fs.update_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.EntityAlreadyExists.code);
                }
            });

            it('update_user with new_username should return user params', async function() {
                const dummy_user2_new_username = dummy_user2.username + '-new-user-name';
                let params = {
                    username: dummy_user2.username,
                    new_username: dummy_user2_new_username,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.update_user(params, account_sdk);
                expect(res.iam_path).toBe(IAM_DEFAULT_PATH);
                expect(res.username).toBe(params.new_username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    params.new_username, true);
                expect(user_account_config_file.name).toBe(params.new_username);
                // back as it was
                params = {
                    username: dummy_user2_new_username,
                    new_username: dummy_user2.username,
                };
                await accountspace_fs.update_user(params, account_sdk);
            });

            it('update_user should return user params (user has access_keys)', async function() {
                const account_sdk = make_dummy_account_sdk();
                // create the user
                let params = {
                    username: dummy_username3,
                };
                await accountspace_fs.create_user(params, account_sdk);
                // create the access key
                params = {
                    username: dummy_username3,
                };
                const res_access_key_creation = await accountspace_fs.create_access_key(params, account_sdk);
                const access_key = res_access_key_creation.access_key;

                // rename the user
                const dummy_new_username = dummy_username3 + '-new-user-name';
                params = {
                    username: dummy_username3,
                    new_username: dummy_new_username,
                };
                const res = await accountspace_fs.update_user(params, account_sdk);
                expect(res.iam_path).toBe(IAM_DEFAULT_PATH);
                expect(res.username).toBe(params.new_username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    params.new_username, true);
                expect(user_account_config_file.name).toBe(params.new_username);
                const symlink_config_path = path.join(accountspace_fs.access_keys_dir, access_key + '.symlink');
                await fs_utils.file_must_exist(symlink_config_path);
                const user_account_config_file_from_symlink = await read_config_file(accountspace_fs.access_keys_dir, access_key, true);
                expect(user_account_config_file_from_symlink.name).toBe(params.new_username);
            });
        });

        describe('delete_user', () => {
            it('delete_user does not return any params (requesting account is root account to create IAM user)', async function() {
                const params = {
                    username: dummy_user1.username,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.delete_user(params, account_sdk);
                expect(res).toBeUndefined();
                const user_account_config_path = path.join(path.join(
                    accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    params.username + '.json');
                await fs_utils.file_must_not_exist(user_account_config_path);
            });

            it('delete_user does not return any params (requesting account is root accounts manager to create root account user)', async function() {
                const params = {
                    username: dummy_user_root_account.username,
                };
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                const res = await accountspace_fs.delete_user(params, account_sdk);
                expect(res).toBeUndefined();
                const user_account_config_path = path.join(accountspace_fs.root_accounts_dir,
                    account_sdk.requesting_account.name.unwrap(), params.username + '.json');
                await fs_utils.file_must_not_exist(user_account_config_path);
            });

            it('delete_user should return an error if requesting user is not a root account user', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                    };
                    const account_sdk = make_dummy_account_sdk_non_root_user();
                    await accountspace_fs.delete_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });

            it('delete_user should return an error if user to delete is a root account user', async function() {
                try {
                    const params = {
                        username: root_user_root_accounts_manager.name,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.delete_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('delete_user should return an error if user account does not exist', async function() {
                try {
                    const params = {
                        username: 'non-existing-user',
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.delete_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('delete_user should return an error if user is not owned by the root account', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                    };
                    const account_sdk = make_dummy_account_sdk_not_for_creating_resources();
                    await accountspace_fs.delete_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('delete_user should return an error if user has access keys', async function() {
                const params = {
                    username: dummy_user2.username,
                };
                const account_sdk = make_dummy_account_sdk();
                try {
                    // create the access key
                    // same params
                    await accountspace_fs.create_access_key(params, account_sdk);
                    await accountspace_fs.delete_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.DeleteConflict.code);
                    expect(err).toHaveProperty('message');
                    expect(err.message).toMatch(/must delete access keys first/i);
                    const user_account_config_path = path.join(
                        path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                        params.username + '.symlink');
                    await fs_utils.file_must_exist(user_account_config_path);
                }
            });

            it('delete_user should return an error if user has IAM users', async function() {
                const username_for_root_account = dummy_username6;
                const params = {
                    username: username_for_root_account,
                };
                let account_sdk;
                try {
                    account_sdk = make_dummy_account_sdk_root_accounts_manager();
                    // create the root account
                    await accountspace_fs.create_user(params, account_sdk);
                    // create the root account access key
                    // same params
                    await accountspace_fs.create_access_key(params, account_sdk);
                    // create a user with the root account
                    const account_config_file = await read_config_file(
                        path.join(accountspace_fs.root_accounts_dir, dummy_username6),
                        username_for_root_account, true);
                    const root_account_manager_id = account_sdk.requesting_account._id;
                    const account_sdk_root = make_dummy_account_sdk_from_root_accounts_manager(
                        account_config_file, root_account_manager_id);
                    const username = dummy_username7;
                    const params_for_iam_user_creation = {
                        username: username,
                    };
                    await accountspace_fs.create_user(params_for_iam_user_creation, account_sdk_root);
                    // delete the created root account
                    // same params
                    await accountspace_fs.delete_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.DeleteConflict.code);
                    expect(err).toHaveProperty('message');
                    expect(err.message).toMatch(/must delete IAM users first/i);
                    const user_account_config_path = path.join(
                        accountspace_fs.root_accounts_dir, dummy_username6,
                        dummy_username7 + '.symlink');
                    await fs_utils.file_must_exist(user_account_config_path);
                }
            });

            it('delete_user should return an error if user has buckets', async function() {
                const username_for_root_account = dummy_username8;
                const params = {
                    username: username_for_root_account,
                };
                let account_sdk;
                try {
                    account_sdk = make_dummy_account_sdk_root_accounts_manager();
                    // create the root account
                    await accountspace_fs.create_user(params, account_sdk);
                    // create a dummy bucket
                    const bucket_name = `my-bucket-${params.username}`;
                    const user_account_config_file = await read_config_file(
                        path.join(accountspace_fs.root_accounts_dir, params.username),
                        params.username, true);
                    await create_dummy_bucket(user_account_config_file, bucket_name);
                    await accountspace_fs.delete_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.DeleteConflict.code);
                    expect(err).toHaveProperty('message');
                    expect(err.message).toMatch(/must delete buckets first/i);
                    const user_account_config_path = path.join(accountspace_fs.root_accounts_dir,
                        params.username, params.username + '.symlink');
                    await fs_utils.file_must_exist(user_account_config_path);
                }
            });
        });

        describe('list_users', () => {
            it('list_users return array of users and value of is_truncated (requesting account is root account to create IAM user)', async function() {
                const params = {};
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.list_users(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(res.members.length).toBeGreaterThan(0);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
            });

            it('list_users return array of users and value of is_truncated (requesting account is root accounts manager to create root account user)', async function() {
                const params = {};
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                const res = await accountspace_fs.list_users(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(res.members.length).toBeGreaterThan(1); //  will always have at least 1 account (himself)
                expect(typeof res.is_truncated === 'boolean').toBe(true);
            });

            it('list_users return an empty array of users and value of is_truncated if non of the users has the iam_path_prefix', async function() {
                const params = {
                    iam_path_prefix: 'non_existing_division/non-existing_subdivision'
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.list_users(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(res.members.length).toBe(0);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
            });

            it('list_users return an array with users that their iam_path starts with iam_path_prefix and value of is_truncated', async function() {
                // add iam_path in a user so we can use the iam_path_prefix and get a user
                const iam_path_to_add = dummy_iam_path;
                let params_for_update = {
                    username: dummy_user2.username,
                    new_iam_path: iam_path_to_add,
                };
                const account_sdk = make_dummy_account_sdk();
                await accountspace_fs.update_user(params_for_update, account_sdk);
                // list with iam_path_prefix
                const params = {
                    iam_path_prefix: '/division_abc/'
                };
                const res = await accountspace_fs.list_users(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(res.members.length).toBe(1);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
                // back as it was
                params_for_update = {
                    username: dummy_user2.username,
                    new_iam_path: IAM_DEFAULT_PATH,
                };
                await accountspace_fs.update_user(params_for_update, account_sdk);
            });

            it('list_users should return an error if requesting user is not a root account user', async function() {
                try {
                    const params = {};
                    const account_sdk = make_dummy_account_sdk_non_root_user();
                    await accountspace_fs.list_users(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });
        });
    });

    describe('Accountspace_FS Access Keys tests', () => {
        const dummy_path = '/division_abc/subdivision_xyz/';
        const dummy_username1 = 'Bob';
        const dummy_username2 = 'Robert';
        const dummy_username3 = 'Alice';
        const dummy_username4 = 'James';
        const dummy_username5 = 'Oliver';
        const dummy_username6 = 'Henry';
        const dummy_username7 = 'Noah';
        const dummy_user1 = {
            username: dummy_username1,
            path: dummy_path,
        };
        const dummy_user2 = {
            username: dummy_username2,
            path: dummy_path,
        };
        const dummy_user3 = {
            username: dummy_username3,
            path: dummy_path,
        };
        const dummy_user_root_account = {
            username: dummy_username7,
        };

        beforeAll(async () => {
            await fs_utils.create_fresh_path(accountspace_fs.accounts_dir);
            await fs_utils.create_fresh_path(accountspace_fs.root_accounts_dir);
            await fs_utils.create_fresh_path(accountspace_fs.access_keys_dir);
            await fs_utils.create_fresh_path(accountspace_fs.buckets_dir);
            await fs_utils.create_fresh_path(new_buckets_path1);
            await fs.promises.chown(new_buckets_path1,
                root_user_root_accounts_manager.nsfs_account_config.uid, root_user_root_accounts_manager.nsfs_account_config.gid);

            for (const account of [root_user_root_accounts_manager, root_user_account, root_user_account2]) {
                await fs_utils.create_fresh_path(path.join(accountspace_fs.root_accounts_dir, account.name));
                const account_path = accountspace_fs._get_account_config_path(account._id);
                // assuming that the root account has only 1 access key in the 0 index
                const account_access_path = accountspace_fs._get_access_keys_config_path(account.access_keys[0].access_key);
                const root_account_path = await accountspace_fs._get_account_config_path_by_root_name(account.name, account.name);
                await fs.promises.writeFile(account_path, JSON.stringify(account));
                await fs.promises.chmod(account_path, 0o600);
                await fs.promises.symlink(account_path, account_access_path);
                await fs.promises.symlink(account_path, root_account_path);
            }
        });
        afterAll(async () => {
            fs_utils.folder_delete(config_root);
            fs_utils.folder_delete(new_buckets_path1);
        });

        describe('create_access_key', () => {
            it('create_access_key should return an error if requesting user is not a root account user', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                        path: dummy_user1.path,
                    };
                    const account_sdk = make_dummy_account_sdk_non_root_user();
                    await accountspace_fs.create_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });

            it('create_access_key should return an error if user account does not exist', async function() {
                try {
                    const params = {
                        username: 'non-existing-user',
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.create_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('create_access_key should return an error if user is not owned by the root account', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.create_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('create_access_key should return user access key params (first time)', async function() {
                const account_sdk = make_dummy_account_sdk();
                // create the user
                const params_for_user_creation = {
                    username: dummy_user1.username,
                    path: dummy_user1.path,
                };
                await accountspace_fs.create_user(params_for_user_creation, account_sdk);
                // create the access key
                const params = {
                    username: dummy_username1,
                };
                const res = await accountspace_fs.create_access_key(params, account_sdk);
                expect(res.username).toBe(dummy_username1);
                expect(res.access_key).toBeDefined();
                expect(res.status).toBe('Active');
                expect(res.secret_key).toBeDefined();

                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    params.username, true);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(1);

                const access_key = res.access_key;
                const user_account_config_file_from_symlink = await read_config_file(accountspace_fs.access_keys_dir, access_key, true);
                expect(user_account_config_file_from_symlink.name).toBe(params.username);
                expect(user_account_config_file_from_symlink.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file_from_symlink.access_keys)).toBe(true);
            });

            it('create_access_key should return user access key params (second time)', async function() {
                const account_sdk = make_dummy_account_sdk();
                // user was already created
                // create the access key
                const params = {
                    username: dummy_username1,
                };
                const res = await accountspace_fs.create_access_key(params, account_sdk);
                expect(res.username).toBe(dummy_username1);
                expect(res.access_key).toBeDefined();
                expect(res.status).toBe('Active');
                expect(res.secret_key).toBeDefined();

                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()), params.username, true);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(2);

                const access_key = res.access_key;
                const user_account_config_file_from_symlink = await read_config_file(accountspace_fs.access_keys_dir, access_key, true);
                expect(user_account_config_file_from_symlink.name).toBe(params.username);
                expect(user_account_config_file_from_symlink.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file_from_symlink.access_keys)).toBe(true);
                expect(user_account_config_file_from_symlink.access_keys.length).toBe(2);
            });

            it('create_access_key should return an error if user already has 2 access keys', async function() {
                try {
                    const account_sdk = make_dummy_account_sdk();
                    // user was already created
                    // create the access key
                    const params = {
                        username: dummy_username1,
                    };
                    await accountspace_fs.create_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.LimitExceeded.code);
                }
            });

            it('create_access_key should return user access key params (requester is an IAM user)', async function() {
                let account_sdk = make_dummy_account_sdk();
                // create the user
                const params_for_user_creation = {
                    username: dummy_username5,
                };
                await accountspace_fs.create_user(params_for_user_creation, account_sdk);
                // create the first access key by the root account
                const params_for_access_key_creation = {
                    username: dummy_username5,
                };
                await accountspace_fs.create_access_key(params_for_access_key_creation, account_sdk);
                let user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username5, true);
                // create the second access key
                // by the IAM user
                account_sdk = make_dummy_account_sdk_created_from_another_account(user_account_config_file,
                    account_sdk.requesting_account._id);
                const params = {};
                const res = await accountspace_fs.create_access_key(params, account_sdk);
                expect(res.username).toBe(dummy_username5);
                expect(res.access_key).toBeDefined();
                expect(res.status).toBe('Active');
                expect(res.secret_key).toBeDefined();

                user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, root_user_account.name),
                    dummy_username5, true);
                expect(user_account_config_file.name).toBe(dummy_username5);
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(2);

                const access_key = res.access_key;
                const user_account_config_file_from_symlink = await read_config_file(accountspace_fs.access_keys_dir, access_key, true);
                expect(user_account_config_file_from_symlink.name).toBe(dummy_username5);
                expect(user_account_config_file_from_symlink.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file_from_symlink.access_keys)).toBe(true);
                expect(user_account_config_file_from_symlink.access_keys.length).toBe(2);
            });

            it('create_access_key should return an error if user is not owned by the root account (requester is an IAM user)', async function() {
                try {
                    // both IAM users are under the same root account (owner property)
                    let account_sdk = make_dummy_account_sdk();
                    const user_account_config_file = await read_config_file(
                        path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                        dummy_username5, true);
                    // create the second access key
                    // by the IAM user
                    account_sdk = make_dummy_account_sdk_created_from_another_account(user_account_config_file,
                        account_sdk.requesting_account._id);
                    const params = {
                        username: dummy_user1.username,
                    };
                    await accountspace_fs.create_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });

            it('create_access_key should return user access key params (requesting account is root accounts manager to create access keys for root account user)', async function() {
                const username = dummy_user_root_account.username;
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                // create the user
                const params = {
                    username: username,
                };
                await accountspace_fs.create_user(params, account_sdk);
                // create the access key
                const res = await accountspace_fs.create_access_key(params, account_sdk);
                expect(res.username).toBe(username);
                expect(res.access_key).toBeDefined();
                expect(res.status).toBe('Active');
                expect(res.secret_key).toBeDefined();

                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, params.username),
                    params.username, true);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(1);

                const access_key = res.access_key;
                const user_account_config_file_from_symlink = await read_config_file(accountspace_fs.access_keys_dir, access_key, true);
                expect(user_account_config_file_from_symlink.name).toBe(params.username);
                expect(user_account_config_file_from_symlink.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file_from_symlink.access_keys)).toBe(true);
            });

            it('create_access_key should return an error if user is IAM user (requesting account is root accounts manager)', async function() {
                try {
                    // user already created (IAM user)
                    // create the access key
                    const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                    const params = {
                        username: dummy_username1,
                    };
                    await accountspace_fs.create_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });
        });

        describe('get_access_key_last_used', () => {
            const dummy_region = 'us-west-2';
            it('get_access_key_last_used should return user access key params (requesting account is root account to create IAM user)', async function() {
                const account_sdk = make_dummy_account_sdk();
                // create the user
                const params_for_user_creation = {
                    username: dummy_user2.username,
                    path: dummy_user2.path,
                };
                await accountspace_fs.create_user(params_for_user_creation, account_sdk);
                // create the access key
                const params_for_access_key_creation = {
                    username: dummy_user2.username,
                };
                const res_access_key_created = await accountspace_fs.create_access_key(params_for_access_key_creation, account_sdk);
                const dummy_access_key = res_access_key_created.access_key;
                // get the access key
                const params = {
                    access_key: dummy_access_key,
                };
                const res = await accountspace_fs.get_access_key_last_used(params, account_sdk);
                expect(res.region).toBe(dummy_region);
                expect(res).toHaveProperty('last_used_date');
                expect(res).toHaveProperty('service_name');
                expect(res.username).toBe(dummy_user2.username);
            });

            it('get_access_key_last_used should return an error if access key does not exist', async function() {
                try {
                    const dummy_access_key = 'AKIAIOSFODNN7EXAMPLE';
                    const account_sdk = make_dummy_account_sdk();
                    // user was already created
                    const params = {
                        access_key: dummy_access_key,
                    };
                    await accountspace_fs.get_access_key_last_used(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('get_access_key_last_used should return an error if access key exists in another root account', async function() {
                try {
                    const account_sdk = make_dummy_account_sdk();
                    // create the user
                    const params_for_user_creation = {
                        username: dummy_user3.username,
                        path: dummy_user3.path,
                    };
                    await accountspace_fs.create_user(params_for_user_creation, account_sdk);
                    // create the access key
                    const params_for_access_key_creation = {
                        username: dummy_user3.username,
                    };
                    const res_access_key_created = await accountspace_fs.create_access_key(params_for_access_key_creation, account_sdk);
                    const dummy_access_key = res_access_key_created.access_key;
                    // get the access key - by another root account
                    const account_sdk2 = make_dummy_account_sdk_not_for_creating_resources();
                    const params = {
                        access_key: dummy_access_key,
                    };
                    await accountspace_fs.get_access_key_last_used(params, account_sdk2);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('get_access_key_last_used should return user access key params (requester is an IAM user)', async function() {
                const username = dummy_user2.username;
                let account_sdk = make_dummy_account_sdk();
                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    username, true);
                // by the IAM user
                account_sdk = make_dummy_account_sdk_created_from_another_account(user_account_config_file, user_account_config_file.owner);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    access_key: access_key,
                };
                const res = await accountspace_fs.get_access_key_last_used(params, account_sdk);
                expect(res.region).toBe(dummy_region);
                expect(res).toHaveProperty('last_used_date');
                expect(res).toHaveProperty('service_name');
                expect(res.username).toBe(username);
            });

            it('get_access_key_last_used return an error if user is not owned by the root account (requester is an IAM user)', async function() {
                try {
                    const requester_account_config_file = await read_config_file(
                        path.join(accountspace_fs.root_accounts_dir, root_user_account.name),
                        dummy_user2.username, true);
                    // by the IAM user
                    const account_sdk = make_dummy_account_sdk_created_from_another_account(requester_account_config_file,
                        requester_account_config_file.owner);
                    const user_account_config_file = await read_config_file(
                        path.join(accountspace_fs.root_accounts_dir, dummy_user_root_account.username),
                        dummy_user_root_account.username, true);
                    const access_key = user_account_config_file.access_keys[0].access_key;
                    const params = {
                        access_key: access_key,
                    };
                    await accountspace_fs.get_access_key_last_used(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('get_access_key_last_used should return user access key params (requesting account is root accounts manager requested account is root account)', async function() {
                const username = dummy_user_root_account.username;
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                // user was already created
                // create the access key
                const params_for_access_key_creation = {
                    username: username,
                };
                const res_access_key_created = await accountspace_fs.create_access_key(params_for_access_key_creation, account_sdk);
                const dummy_access_key = res_access_key_created.access_key;
                // get the access key
                const params = {
                    access_key: dummy_access_key,
                };
                const res = await accountspace_fs.get_access_key_last_used(params, account_sdk);
                expect(res.region).toBe(dummy_region);
                expect(res).toHaveProperty('last_used_date');
                expect(res).toHaveProperty('service_name');
                expect(res.username).toBe(username);
            });
        });

        describe('update_access_key', () => {
            it('update_access_key should return an error if requesting user is not a root account user', async function() {
                const dummy_access_key = 'pHqFNglDiq7eA0Q4XETq';
                try {
                    const params = {
                        username: dummy_username1,
                        access_key: dummy_access_key,
                        status: ACCESS_KEY_STATUS_ENUM.ACTIVE,
                    };
                    const account_sdk = make_dummy_account_sdk_non_root_user();
                    await accountspace_fs.update_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });

            it('update_access_key should return an error if access key does not exist', async function() {
                const dummy_access_key = 'pHqFNglDiq7eA0Q4XETq';
                try {
                    const params = {
                        username: dummy_username1,
                        access_key: dummy_access_key,
                        status: ACCESS_KEY_STATUS_ENUM.ACTIVE,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.update_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('update_access_key should return an error if user account does not exist', async function() {
                const user_account = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, root_user_account.name),
                    dummy_username1, true);
                const dummy_access_key = user_account.access_keys[0].access_key;
                try {
                    const params = {
                        username: 'non-existing-user',
                        access_key: dummy_access_key,
                        status: ACCESS_KEY_STATUS_ENUM.ACTIVE,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.update_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                    expect(err.message).toMatch(/user with name/i);
                }
            });

            it('update_access_key should return an error if access key belongs to another account ' +
                    'without passing the username flag', async function() {
                const account_sdk = make_dummy_account_sdk();
                const user_account = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username1, true);
                const dummy_access_key = user_account.access_keys[0].access_key;
                try {
                    const params = {
                        // without username of dummy_username1
                        access_key: dummy_access_key,
                        status: ACCESS_KEY_STATUS_ENUM.ACTIVE,
                    };
                    await accountspace_fs.update_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('update_access_key should return an error if access key is on another root account', async function() {
                try {
                    const account_sdk = make_dummy_account_sdk_not_for_creating_resources();
                    const user_account_config_file = await read_config_file(
                        path.join(accountspace_fs.root_accounts_dir, root_user_account.name),
                        dummy_username1, true);
                    const access_key = user_account_config_file.access_keys[0].access_key;
                    const params = {
                        username: dummy_username1,
                        access_key: access_key,
                        status: ACCESS_KEY_STATUS_ENUM.INACTIVE,
                    };
                    await accountspace_fs.update_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('update_access_key should not return any param (update status to Inactive) (requesting account is root account to create IAM user)', async function() {
                const account_sdk = make_dummy_account_sdk();
                let user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username1, true);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: dummy_username1,
                    access_key: access_key,
                    status: ACCESS_KEY_STATUS_ENUM.INACTIVE,
                };
                const res = await accountspace_fs.update_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username1, true);
                expect(user_account_config_file.access_keys[0].deactivated).toBe(true);
            });

            it('update_access_key should not return any param (update status to Active) (requesting account is root account to create IAM user)', async function() {
                const account_sdk = make_dummy_account_sdk();
                let user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username1, true);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: dummy_username1,
                    access_key: access_key,
                    status: ACCESS_KEY_STATUS_ENUM.ACTIVE,
                };
                const res = await accountspace_fs.update_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username1, true);
                expect(user_account_config_file.access_keys[0].deactivated).toBe(false);
            });

            it('update_access_key should not return any param (update status to Active, already was Active) (requesting account is root account to create IAM user)', async function() {
                const account_sdk = make_dummy_account_sdk();
                let user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username1, true);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: dummy_username1,
                    access_key: access_key,
                    status: ACCESS_KEY_STATUS_ENUM.ACTIVE,
                };
                const res = await accountspace_fs.update_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username1, true);
                expect(user_account_config_file.access_keys[0].deactivated).toBe(false);
            });

            it('update_access_key should not return any param (requester is an IAM user)', async function() {
                const dummy_username = dummy_username5;
                let user_account_config_file = await read_config_file(path.join(
                    accountspace_fs.root_accounts_dir, root_user_account.name),
                    dummy_username, true);
                // by the IAM user
                const account_sdk = make_dummy_account_sdk_created_from_another_account(user_account_config_file,
                    user_account_config_file.owner);
                const access_key = user_account_config_file.access_keys[1].access_key;
                const params = {
                    access_key: access_key,
                    status: ACCESS_KEY_STATUS_ENUM.INACTIVE,
                    'user-name': account_sdk.requesting_account.name.unwrap()
                };
                const res = await accountspace_fs.update_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, root_user_account.name),
                    dummy_username, true);
                expect(user_account_config_file.access_keys[1].deactivated).toBe(true);
            });

            it('update_access_key should return an error if user is not owned by the root account (requester is an IAM user)', async function() {
                try {
                    // both IAM users are under the same root account (owner property)
                    let account_sdk = make_dummy_account_sdk();
                    const user_account_config_file = await read_config_file(
                        path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                        dummy_username5, true);
                    const access_key = user_account_config_file.access_keys[0].access_key;
                    // create the second access key
                    // by the IAM user
                    account_sdk = make_dummy_account_sdk_created_from_another_account(user_account_config_file,
                        account_sdk.requesting_account._id);
                    const params = {
                        username: dummy_user1.username,
                        access_key: access_key,
                        status: ACCESS_KEY_STATUS_ENUM.INACTIVE,
                    };
                    await accountspace_fs.update_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });

            it('update_access_key should not return any param (update status to Inactive) (requesting account is root accounts manager requested account is root account)', async function() {
                const username = dummy_user_root_account.username;
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                let user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, username),
                    username, true);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: username,
                    access_key: access_key,
                    status: ACCESS_KEY_STATUS_ENUM.INACTIVE,
                };
                const res = await accountspace_fs.update_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, username),
                    username, true);
                expect(user_account_config_file.access_keys[0].deactivated).toBe(true);
            });
        });

        describe('delete_access_key', () => {
            it('delete_access_key should return an error if requesting user is not a root account user', async function() {
                const dummy_access_key = 'pHqFNglDiq7eA0Q4XETq';
                try {
                    const params = {
                        username: dummy_username1,
                        access_key: dummy_access_key,
                    };
                    const account_sdk = make_dummy_account_sdk_non_root_user();
                    await accountspace_fs.delete_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });

            it('delete_access_key should return an error if access key does not exist', async function() {
                const dummy_access_key = 'pHqFNglDiq7eA0Q4XETq';
                try {
                    const params = {
                        username: dummy_username1,
                        access_key: dummy_access_key,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.delete_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('delete_access_key should return an error if user account does not exist', async function() {
                const user_account = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, root_user_account.name), dummy_username1, true);
                const dummy_access_key = user_account.access_keys[0].access_key;
                try {
                    const params = {
                        username: 'non-existing-user',
                        access_key: dummy_access_key,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.delete_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                    expect(err.message).toMatch(/user with name/i);
                }
            });

            it('delete_access_key should return an error if access key belongs to another account ' +
                'without passing the username flag', async function() {
            const user_account = await read_config_file(
                path.join(accountspace_fs.root_accounts_dir, root_user_account.name), dummy_username1, true);
            const dummy_access_key = user_account.access_keys[0].access_key;
            try {
                const params = {
                    // without username of dummy_username1
                    access_key: dummy_access_key,
                };
                const account_sdk = make_dummy_account_sdk();
                await accountspace_fs.delete_access_key(params, account_sdk);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
            }
        });

            it('delete_access_key should return an error if access key is on another root account', async function() {
                try {
                    const account_sdk = make_dummy_account_sdk_not_for_creating_resources();
                    const user_account_config_file = await read_config_file(
                        path.join(accountspace_fs.root_accounts_dir, root_user_account.name),
                        dummy_username1, true);
                    const access_key = user_account_config_file.access_keys[0].access_key;
                    const params = {
                        username: dummy_username1,
                        access_key: access_key,
                    };
                    await accountspace_fs.delete_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('delete_access_key should not return any param (requesting account is root account to create IAM user)', async function() {
                const account_sdk = make_dummy_account_sdk();
                let user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username1, true);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: dummy_username1,
                    access_key: access_key,
                };
                const res = await accountspace_fs.delete_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username1, true);
                expect(user_account_config_file.access_keys.length).toBe(1);
                const symlink_config_path = path.join(accountspace_fs.access_keys_dir, access_key + '.symlink');
                await fs_utils.file_must_not_exist(symlink_config_path);
            });

            it('delete_access_key should not return any param (account with 2 access keys) (requesting account is root account to create IAM user)', async function() {
                const username = dummy_username6;
                const account_sdk = make_dummy_account_sdk();
                // create the user
                let params = {
                    username: username,
                };
                await accountspace_fs.create_user(params, account_sdk);
                // create the access key (first time)
                params = {
                    username: username,
                };
                // create the access key (second time)
                const access_creation = await accountspace_fs.create_access_key(params, account_sdk);
                const access_key_to_delete = access_creation.access_key;
                // create the access key (second time)
                const access_creation2 = await accountspace_fs.create_access_key(params, account_sdk);
                const access_key = access_creation2.access_key;
                params = {
                    username: username,
                    access_key: access_key_to_delete,
                };
                const res = await accountspace_fs.delete_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    username, true);
                expect(user_account_config_file.access_keys.length).toBe(1);
                expect(user_account_config_file.access_keys[0].access_key).toBe(access_key);
                expect(user_account_config_file.access_keys[0].access_key).not.toBe(access_key_to_delete);
                let symlink_config_path = path.join(accountspace_fs.access_keys_dir, access_key_to_delete + '.symlink');
                await fs_utils.file_must_not_exist(symlink_config_path);
                symlink_config_path = path.join(accountspace_fs.access_keys_dir, access_key + '.symlink');
                await fs_utils.file_must_exist(symlink_config_path);
            });

            it('delete_access_key should not return any param (requester is an IAM user)', async function() {
                let account_sdk = make_dummy_account_sdk();
                let user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username5, true);
                // by the IAM user
                account_sdk = make_dummy_account_sdk_created_from_another_account(user_account_config_file, user_account_config_file.owner);
                const access_key = user_account_config_file.access_keys[1].access_key;
                const params = {
                    access_key: access_key,
                };
                const res = await accountspace_fs.delete_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, root_user_account.name),
                    dummy_username1, true);
                expect(user_account_config_file.access_keys.length).toBe(1);
                expect(user_account_config_file.access_keys[0].access_key).not.toBe(access_key);
                const symlink_config_path = path.join(accountspace_fs.access_keys_dir, access_key + '.symlink');
                await fs_utils.file_must_not_exist(symlink_config_path);
            });

            it('delete_access_key should return an error if user is not owned by the root account (requester is an IAM user)', async function() {
                try {
                    // both IAM users are under the same root account (owner property)
                    let account_sdk = make_dummy_account_sdk();
                    const user_account_config_file = await read_config_file(
                        path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                        dummy_username5, true);
                    const access_key = user_account_config_file.access_keys[0].access_key;
                    // create the second access key
                    // by the IAM user
                    account_sdk = make_dummy_account_sdk_created_from_another_account(user_account_config_file,
                        account_sdk.requesting_account._id);
                    const params = {
                        username: dummy_user1.username,
                        access_key: access_key,
                    };
                    await accountspace_fs.delete_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });

            it('delete_access_key should not return any param (requesting account is root accounts manager requested account is root account)', async function() {
                const username = dummy_user_root_account.username;
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                let user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, username),
                    username, true);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: username,
                    access_key: access_key,
                };
                const res = await accountspace_fs.delete_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, username),
                    username, true);
                expect(user_account_config_file.access_keys.length).toBe(1);
                const symlink_config_path = path.join(accountspace_fs.access_keys_dir, access_key + '.symlink');
                await fs_utils.file_must_not_exist(symlink_config_path);
            });
        });

        describe('list_access_keys', () => {
            it('list_access_keys return array of access_keys and value of is_truncated (requesting account is root account and requested account is IAM user)', async function() {
                const params = {
                    username: dummy_username1,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.list_access_keys(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
                expect(res.members.length).toBe(1);
                expect(res.members[0]).toHaveProperty('username', dummy_username1);
                expect(res.members[0].access_key).toBeDefined();
                expect(res.members[0].status).toBeDefined();
                expect(res.members[0].create_date).toBeDefined();
            });

            it('list_access_keys should return an error when username does not exists', async function() {
                const non_exsting_user = 'non_exsting_user';
                try {
                    const params = {
                        username: non_exsting_user,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.list_access_keys(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                    expect(err.message).toMatch(/user with name/i);
                }
            });

            it('list_access_keys should return an error when username does not exists (in the root account)', async function() {
                try {
                    const params = {
                        username: dummy_username1,
                    };
                    const account_sdk = make_dummy_account_sdk_not_for_creating_resources();
                    await accountspace_fs.list_access_keys(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('list_access_keys return empty array of access_keys is user does not have access_keys', async function() {
                const account_sdk = make_dummy_account_sdk();
                // create the user
                const params_for_user_creation = {
                    username: dummy_username4,
                };
                await accountspace_fs.create_user(params_for_user_creation, account_sdk);
                // list the access_keys
                const params = {
                    username: dummy_username4,
                };
                const res = await accountspace_fs.list_access_keys(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
                expect(res.members.length).toBe(0);
            });

            it('list_access_keys return array of access_keys and value of is_truncated (requester is an IAM user)', async function() {
                let account_sdk = make_dummy_account_sdk();
                const user_account_config_file = await read_config_file(
                    path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                    dummy_username5, true);
                // by the IAM user
                account_sdk = make_dummy_account_sdk_created_from_another_account(user_account_config_file, root_user_account._id);
                const params = {};
                const res = await accountspace_fs.list_access_keys(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
                expect(res.members.length).toBe(1);
            });

            it('list_access_keys should return an error if user is not owned by the root account (requester is an IAM user)', async function() {
                try {
                    // both IAM users are under the same root account (owner property)
                    let account_sdk = make_dummy_account_sdk();
                    const user_account_config_file = await read_config_file(
                        path.join(accountspace_fs.root_accounts_dir, account_sdk.requesting_account.name.unwrap()),
                        dummy_username5, true);
                    const access_key = user_account_config_file.access_keys[0].access_key;
                    // create the second access key
                    // by the IAM user
                    account_sdk = make_dummy_account_sdk_created_from_another_account(user_account_config_file,
                        account_sdk.requesting_account._id);
                    const params = {
                        username: dummy_user1.username,
                        access_key: access_key,
                    };
                    await accountspace_fs.list_access_keys(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDeniedException.code);
                }
            });

            it('list_access_keys return array of access_keys and value of is_truncated (requesting account is root accounts manager requested account is root account)', async function() {
                const username = dummy_user_root_account.username;
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                const params = {
                    username: username,
                };
                const res = await accountspace_fs.list_access_keys(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
                expect(res.members.length).toBe(1);
                expect(res.members[0]).toHaveProperty('username', username);
                expect(res.members[0].access_key).toBeDefined();
                expect(res.members[0].status).toBeDefined();
                expect(res.members[0].create_date).toBeDefined();
            });
        });
    });
});


/**
 * read_config_file will read the config files 
 * @param {string} account_path full account path
 * @param {string} config_file_name the name of the config file
 * @param {boolean} [is_symlink] a flag to set the suffix as a symlink instead of json
 */

async function read_config_file(account_path, config_file_name, is_symlink) {
    const config_path = path.join(account_path, config_file_name + (is_symlink ? '.symlink' : '.json'));
    const { data } = await nb_native().fs.readFile(DEFAULT_FS_CONFIG, config_path);
    const config_data = JSON.parse(data.toString());
    if (config_data.access_keys.length > 0) {
        const encrypted_secret_key = config_data.access_keys[0].encrypted_secret_key;
        config_data.access_keys[0].secret_key = await nc_mkm.decrypt(encrypted_secret_key, config_data.master_key_id);
        delete config_data.access_keys[0].encrypted_secret_key;
    }
    return config_data;
}

async function create_dummy_bucket(account, bucket_name) {
    const bucket_storage_path = path.join(account.nsfs_account_config.new_buckets_path, bucket_name);
    const bucket = _new_bucket_defaults(account, bucket_name, bucket_storage_path);
    const bucket_config = JSON.stringify(bucket);
    const bucket_to_validate = JSON.parse(bucket_config);
    nsfs_schema_utils.validate_bucket_schema(bucket_to_validate);
    const bucket_config_path = path.join(accountspace_fs.buckets_dir, bucket_name + '.json');
    await native_fs_utils.create_config_file(accountspace_fs.fs_context, accountspace_fs.buckets_dir, bucket_config_path, bucket_config);
    return bucket_config_path;
}

// parital copy from bucketspace_fs
function _new_bucket_defaults(account, bucket_name, bucket_storage_path) {
    return {
        _id: '65a8edc9bc5d5bbf9db71c75',
        name: bucket_name,
        owner_account: account._id,
        system_owner: account._id,
        creation_date: new Date().toISOString(),
        path: bucket_storage_path,
        should_create_underlying_storage: true,
        versioning: 'DISABLED',
    };
}
