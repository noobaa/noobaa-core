/* Copyright (C) 2024 NooBaa */
/* eslint-disable max-lines-per-function */
/* eslint-disable max-lines */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const SensitiveString = require('../../../util/sensitive_string');
const AccountSpaceFS = require('../../../sdk/accountspace_fs');
const { TMP_PATH, set_nc_config_dir_in_config } = require('../../system_tests/test_utils');
const { IAM_DEFAULT_PATH, ACCESS_KEY_STATUS_ENUM } = require('../../../endpoint/iam/iam_constants');
const fs_utils = require('../../../util/fs_utils');
const { IamError } = require('../../../endpoint/iam/iam_errors');
const nsfs_schema_utils = require('../../../manage_nsfs/nsfs_schema_utils');

class NoErrorThrownError extends Error {}

const tmp_fs_path = path.join(TMP_PATH, 'test_accountspace_fs');
const config_root = path.join(tmp_fs_path, 'config_root');
const new_buckets_path1 = path.join(tmp_fs_path, 'new_buckets_path1', '/');
const new_buckets_path2 = path.join(tmp_fs_path, 'new_buckets_path2', '/');
const new_buckets_path3 = path.join(tmp_fs_path, 'new_buckets_path3', '/');
const accountspace_fs = new AccountSpaceFS({ config_root });
const config_fs_account_options = { show_secrets: true, decrypt_secret_key: true };
set_nc_config_dir_in_config(config_root);

const root_user_account = {
    _id: '65a8edc9bc5d5bbf9db71b91',
    name: 'test-root-account-1001',
    email: 'test-root-account-1001',
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-abcdefghijklmn123456',
        encrypted_secret_key: 's-abcdefghijklmn123456EXAMPLE'
    }],
    nsfs_account_config: {
        uid: 1001,
        gid: 1001,
        new_buckets_path: new_buckets_path1,
    },
    creation_date: '2023-10-30T04:46:33.815Z',
    master_key_id: '65a62e22ceae5e5f1a758123',
};
nsfs_schema_utils.validate_account_schema(root_user_account);

const root_user_account2 = {
    _id: '65a8edc9bc5d5bbf9db71b92',
    name: 'test-root-account-1002',
    email: 'test-root-account-1002',
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-bbcdefghijklmn123456',
        encrypted_secret_key: 's-bbcdefghijklmn123456EXAMPLE'
    }],
    nsfs_account_config: {
        uid: 1002,
        gid: 1002,
        new_buckets_path: new_buckets_path2,
    },
    creation_date: '2023-11-30T04:46:33.815Z',
    master_key_id: '65a62e22ceae5e5f1a758123',
};
nsfs_schema_utils.validate_account_schema(root_user_account2);

const root_user_root_accounts_manager = {
    _id: '65a8edc9bc5d5bbf9db71b93',
    name: 'test-root-accounts-manager-1003',
    email: 'test-root-accounts-manager-1003',
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-cccdefghijklmn123456',
        encrypted_secret_key: 's-cccdefghijklmn123456EXAMPLE'
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
nsfs_schema_utils.validate_account_schema(root_user_root_accounts_manager);

// I'm only interested in the requesting_account field
function make_dummy_account_sdk() {
    return {
            requesting_account: {
                _id: root_user_account._id,
                name: new SensitiveString(root_user_account.name),
                email: new SensitiveString(root_user_account.email),
                creation_date: root_user_account.creation_date,
                access_keys: [{
                    access_key: new SensitiveString(root_user_account.access_keys[0].access_key),
                    // we don't use the secret_key actually and we don't want to involve the master key,
                    // hence in the dummy we will wrap the encrypted_secret_key as secret_key
                    // (instead of decrypt it as needed) - COMMENT ABOUT SECRET_KEY
                    secret_key: new SensitiveString(root_user_account.access_keys[0].encrypted_secret_key)
                }],
                nsfs_account_config: root_user_account.nsfs_account_config,
                allow_bucket_creation: root_user_account.allow_bucket_creation,
                master_key_id: root_user_account.master_key_id,
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
                // see COMMENT ABOUT SECRET_KEY above
                secret_key: new SensitiveString(account.access_keys[0].encrypted_secret_key)
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

// use it for root user that doesn't create the resources (only tries to get, update and delete resources that it doesn't own)
function make_dummy_account_sdk_not_for_creating_resources() {
    return {
            requesting_account: {
                _id: root_user_account2._id,
                name: new SensitiveString(root_user_account2.name),
                email: new SensitiveString(root_user_account2.email),
                creation_date: root_user_account2.creation_date,
                access_keys: [{
                    access_key: new SensitiveString(root_user_account2.access_keys[0].access_key),
                // see COMMENT ABOUT SECRET_KEY above
                    secret_key: new SensitiveString(root_user_account2.access_keys[0].encrypted_secret_key)
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
                // see COMMENT ABOUT SECRET_KEY above
                    secret_key: new SensitiveString(root_user_root_accounts_manager.access_keys[0].encrypted_secret_key)
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
        await accountspace_fs.config_fs.create_config_dirs_if_missing();
        await fs_utils.create_fresh_path(new_buckets_path1);
        await fs_utils.create_fresh_path(new_buckets_path3);
        await fs.promises.chown(new_buckets_path1,
            root_user_account.nsfs_account_config.uid, root_user_account.nsfs_account_config.gid);
        await fs.promises.chown(new_buckets_path3,
            root_user_root_accounts_manager.nsfs_account_config.uid, root_user_root_accounts_manager.nsfs_account_config.gid);


        for (const account of [root_user_account, root_user_account2, root_user_root_accounts_manager]) {
            await accountspace_fs.config_fs.create_account_config_file(account);
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
            it('create_user should return user params (requesting account is root account ' +
                    'to create IAM user)', async function() {
                const params = {
                    username: dummy_user1.username,
                    iam_path: dummy_user1.iam_path,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.create_user(params, account_sdk);
                const owner_account_id = account_sdk.requesting_account._id;
                expect(res.iam_path).toBe(params.iam_path);
                expect(res.username).toBe(params.username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                expect(res.arn).toContain(owner_account_id);
                expect(res.create_date).toBeDefined();

                const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    params.username, owner_account_id, config_fs_account_options);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.email).toBe(params.username);
                expect(user_account_config_file._id).toBeDefined();
                expect(user_account_config_file.creation_date).toBeDefined();
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(0);
                expect(user_account_config_file.owner).toBe(owner_account_id);
                expect(user_account_config_file.creator).toBe(owner_account_id);

                expect(res.arn).toBe(`arn:aws:iam::${owner_account_id}:user${params.iam_path}${params.username}`);
            });

            it('create_user should return user params (requesting account is root account ' +
                'to create IAM user) - username same in another account', async function() {
            const account_sdk = make_dummy_account_sdk_not_for_creating_resources(); // root account 2
            const params = {
                username: dummy_user1.username,
            };
            const res = await accountspace_fs.create_user(params, account_sdk);
            const owner_account_id = account_sdk.requesting_account._id;
            expect(res.username).toBe(params.username);

            const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                params.username, owner_account_id, config_fs_account_options);
            expect(user_account_config_file.name).toBe(params.username);
            expect(user_account_config_file.email).toBe(params.username);

            // back as it was (without the user)
            await accountspace_fs.delete_user(params, account_sdk);
        });

            it('create_user should return user params (requesting account is root accounts manager - ' +
                    'has allow_bucket_creation true with new_buckets_path - to create root account)',
                    async function() {
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

                const user_account_config_file = await accountspace_fs.config_fs.get_account_by_name(
                    params.username, config_fs_account_options);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.email).toBe(params.username);
                expect(user_account_config_file._id).toBeDefined();
                expect(user_account_config_file.creation_date).toBeDefined();
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(0);
                expect(user_account_config_file.allow_bucket_creation).toBe(true);
                expect(user_account_config_file.iam_operate_on_root_account).toBeUndefined();
                expect(user_account_config_file.owner).toBeUndefined();
                expect(user_account_config_file.creator).toBe(account_sdk.requesting_account._id);

                expect(res.arn).toContain(user_account_config_file._id);
                expect(res.arn).toBe(`arn:aws:iam::${user_account_config_file._id}:root`);
            });

            it('create_user should return user params (requesting account is root accounts manager - ' +
                    'has allow_bucket_creation false with new_buckets_path - to create root account)',
                    async function() {
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

                const user_account_config_file = await accountspace_fs.config_fs.get_account_by_name(
                    params.username, config_fs_account_options);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.email).toBe(params.username);
                expect(user_account_config_file._id).toBeDefined();
                expect(user_account_config_file.creation_date).toBeDefined();
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(0);
                expect(user_account_config_file.allow_bucket_creation).toBe(true);
                expect(user_account_config_file.iam_operate_on_root_account).toBeUndefined();
                expect(user_account_config_file.owner).toBeUndefined();
                expect(user_account_config_file.creator).toBe(account_sdk.requesting_account._id);

                expect(res.arn).toContain(user_account_config_file._id);
            });

            it('create_user should return user params (requesting account is root accounts manager - ' +
                    'has allow_bucket_creation false without new_buckets_path - to create root account)',
                    async function() {
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

                const user_account_config_file = await accountspace_fs.config_fs.get_account_by_name(
                    params.username, config_fs_account_options);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.email).toBe(params.username);
                expect(user_account_config_file._id).toBeDefined();
                expect(user_account_config_file.creation_date).toBeDefined();
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(0);
                expect(user_account_config_file.allow_bucket_creation).toBe(false);
                expect(user_account_config_file.iam_operate_on_root_account).toBeUndefined();
                expect(user_account_config_file.owner).toBeUndefined();
                expect(user_account_config_file.creator).toBe(account_sdk.requesting_account._id);

                expect(res.arn).toContain(user_account_config_file._id);
            });

            it('create_user should throw an error if requesting user is not a root account',
                    async function() {
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

            it('create_user should throw an error if username already exists (same account)', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                        iam_path: dummy_user1.iam_path,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    // now username already exists
                    await accountspace_fs.create_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.EntityAlreadyExists.code);
                }
            });

            it('create_user should return user params (requesting account is root account ' +
                'to create IAM user) - username same as root account', async function() {
            const account_sdk = make_dummy_account_sdk_not_for_creating_resources(); // root account 2
            const params = {
                username: dummy_user1.username,
            };
            const res = await accountspace_fs.create_user(params, account_sdk);
            const owner_account_id = account_sdk.requesting_account._id;
            expect(res.username).toBe(params.username);

            const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                params.username, owner_account_id, config_fs_account_options);
            expect(user_account_config_file.name).toBe(params.username);
            expect(user_account_config_file.email).toBe(params.username);

            // back as it was (without the user)
            await accountspace_fs.delete_user(params, account_sdk);
        });
        });

        describe('get_user', () => {
            it('get_user should return user params (requesting account is root account ' +
                    'to get IAM user)', async function() {
                const params = {
                    username: dummy_user1.username,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.get_user(params, account_sdk);
                const owner_account_id = account_sdk.requesting_account._id;
                expect(res.user_id).toBeDefined();
                expect(res.iam_path).toBe(dummy_user1.iam_path);
                expect(res.username).toBe(dummy_user1.username);
                expect(res.arn).toBeDefined();
                expect(res.arn).toContain(owner_account_id);
                expect(res.create_date).toBeDefined();
                expect(res.password_last_used).toBeDefined();

                expect(res.arn).toBe(`arn:aws:iam::${owner_account_id}:user${dummy_user1.iam_path}${params.username}`);
            });

            it('get_user should return user params (requesting account is root accounts manager ' +
                    'to get root account)', async function() {
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

                const account_config_file = await accountspace_fs.config_fs.get_account_by_name(
                    params.username, config_fs_account_options);
                expect(res.arn).toContain(account_config_file._id);
                expect(res.arn).toBe(`arn:aws:iam::${account_config_file._id}:root`);
            });

            it('get_user should throw an error if requesting user is not a root account',
                    async function() {
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

            it('get_user should throw an error if user to get is a username of root account ' +
                '(user account does not exist)', async function() {
                try {
                    const params = {
                        username: root_user_root_accounts_manager.name,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.get_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });

            it('get_user should throw an error if user account does not exist', async function() {
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

            it('get_user should throw an error if user is not owned by the root account' +
                '(user account does not exist)', async function() {
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
            it('update_user without actual property to update should return user params',
                    async function() {
                const params = {
                    username: dummy_user1.username,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.update_user(params, account_sdk);
                const owner_account_id = account_sdk.requesting_account._id;
                expect(res.iam_path).toBe(dummy_user1.iam_path);
                expect(res.username).toBe(dummy_user1.username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                expect(res.arn).toContain(owner_account_id);
                const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    params.username, owner_account_id, config_fs_account_options);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.email).toBe(params.username);
                expect(user_account_config_file.iam_path).toBe(dummy_user1.iam_path);
            });

            it('update_user with new_iam_path should return user params and update the iam_path ' +
                    '(requesting account is root account to create IAM user)', async function() {
                let params = {
                    username: dummy_user1.username,
                    new_iam_path: dummy_iam_path2,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.update_user(params, account_sdk);
                const owner_account_id = account_sdk.requesting_account._id;
                expect(res.iam_path).toBe(dummy_iam_path2);
                expect(res.username).toBe(dummy_user1.username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                expect(res.arn).toContain(owner_account_id);
                expect(res.arn).toContain(params.new_iam_path);
                expect(res.arn).toBe(`arn:aws:iam::${owner_account_id}:user${params.new_iam_path}${params.username}`);
                const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    params.username, owner_account_id, config_fs_account_options);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.email).toBe(params.username);
                expect(user_account_config_file.iam_path).toBe(dummy_iam_path2);
                // back as it was
                params = {
                    username: dummy_user1.username,
                    new_iam_path: dummy_user1.iam_path,
                };
                await accountspace_fs.update_user(params, account_sdk);
            });

            it('update_user with new_iam_path should return user params and update the iam_path ' +
                    '(requesting account is root accounts manager to create root account)',
                    async function() {
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
                const account_config_file = await accountspace_fs.config_fs.get_account_by_name(
                    params.username, config_fs_account_options);
                expect(account_config_file.name).toBe(params.username);
                expect(account_config_file.email).toBe(params.username);
                expect(account_config_file.iam_path).toBe(dummy_iam_path);

                expect(res.arn).toContain(account_config_file._id);
                expect(res.arn).toBe(`arn:aws:iam::${account_config_file._id}:root`);
            });

            it('update_user should throw an error if requesting user is not a root account',
                    async function() {
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

            it('update_user should throw an error if user to update is a root account',
                    async function() {
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

            it('update_user should throw an error if user account does not exist', async function() {
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

            it('update_user should throw an error if user is not owned by the root account',
                    async function() {
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

            it('update_user with new_username should throw an error if username already exists',
                    async function() {
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
                const owner_account_id = account_sdk.requesting_account._id;
                expect(res.iam_path).toBe(IAM_DEFAULT_PATH);
                expect(res.username).toBe(params.new_username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                expect(res.arn).toContain(owner_account_id);
                expect(res.arn).toContain(params.new_username);
                const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    params.new_username, owner_account_id, config_fs_account_options);
                expect(user_account_config_file.name).toBe(params.new_username);
                expect(user_account_config_file.email).toBe(params.new_username);
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
                const owner_account_id = account_sdk.requesting_account._id;
                expect(res.iam_path).toBe(IAM_DEFAULT_PATH);
                expect(res.username).toBe(params.new_username);
                expect(res.user_id).toBeDefined();
                expect(res.arn).toBeDefined();
                expect(res.arn).toContain(owner_account_id);
                expect(res.arn).toContain(params.new_username);
                const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    params.new_username, owner_account_id, config_fs_account_options);
                expect(user_account_config_file.name).toBe(params.new_username);
                expect(user_account_config_file.email).toBe(params.new_username);
                const is_path_exists = await accountspace_fs.config_fs.is_account_exists_by_access_key(access_key);
                expect(is_path_exists).toBe(true);
                const user_account_config_file_from_symlink =
                    await accountspace_fs.config_fs.get_account_by_access_key(access_key, config_fs_account_options);
                expect(user_account_config_file_from_symlink.name).toBe(params.new_username);
                expect(user_account_config_file_from_symlink.email).toBe(params.new_username);
            });
        });

        describe('delete_user', () => {
            it('delete_user does not return any params (requesting account is root account ' +
                    'to delete IAM user)', async function() {
                const params = {
                    username: dummy_user1.username,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.delete_user(params, account_sdk);
                const owner_account_id = account_sdk.requesting_account._id;
                expect(res).toBeUndefined();
                const is_path_exists = await accountspace_fs.config_fs.is_account_exists_by_name(params.username, owner_account_id);
                expect(is_path_exists).toBe(false);
            });

            it('delete_user does not return any params (requesting account is root accounts manager ' +
                    'to delete root account)', async function() {
                const params = {
                    username: dummy_user_root_account.username,
                };
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                const res = await accountspace_fs.delete_user(params, account_sdk);
                expect(res).toBeUndefined();
                const is_path_exists = await accountspace_fs.config_fs.is_account_exists_by_name(params.username);
                expect(is_path_exists).toBe(false);
            });

            it('delete_user should throw an error if requesting user is not a root account',
                    async function() {
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

            it('delete_user should throw an error if user to delete is a root account ' +
                '(user account does not exist)', async function() {
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

            it('delete_user should throw an error if user account does not exist', async function() {
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

            it('delete_user should throw an error if user is not owned by the root account ' +
                '(user account does not exist)', async function() {
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

            it('delete_user should throw an error if user has access keys', async function() {
                const params = {
                    username: dummy_user2.username,
                };
                let owner_account_id;
                try {
                    const account_sdk = make_dummy_account_sdk();
                    owner_account_id = account_sdk.requesting_account._id;
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
                    const is_path_exists = await accountspace_fs.config_fs.is_account_exists_by_name(params.username, owner_account_id);
                    expect(is_path_exists).toBe(true);
                }
            });

            it('delete_user should throw an error if account has IAM users', async function() {
                const username_for_root_account = dummy_username6;
                const params = {
                    username: username_for_root_account,
                };
                try {
                    const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                    // create the root account
                    await accountspace_fs.create_user(params, account_sdk);
                    // create the root account access key
                    // same params
                    await accountspace_fs.create_access_key(params, account_sdk);
                    // create a user with the root account
                    const account_config_file = await accountspace_fs.config_fs.get_account_by_name(params.username,
                        config_fs_account_options);
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
                    const is_path_exists = await accountspace_fs.config_fs.is_account_exists_by_name(params.username);
                    expect(is_path_exists).toBe(true);
                }
            });

            it('delete_user should throw an error if account has buckets', async function() {
                const username_for_root_account = dummy_username8;
                const params = {
                    username: username_for_root_account,
                };
                try {
                    const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                    // create the root account
                    await accountspace_fs.create_user(params, account_sdk);
                    // create a dummy bucket
                    const bucket_name = `my-bucket-${params.username}`;
                    const user_account_config_file = await accountspace_fs.config_fs.get_account_by_name(params.username,
                        config_fs_account_options);
                    await create_dummy_bucket(user_account_config_file, bucket_name);
                    await accountspace_fs.delete_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.DeleteConflict.code);
                    expect(err).toHaveProperty('message');
                    expect(err.message).toMatch(/must delete buckets first/i);
                    const is_path_exists = await accountspace_fs.config_fs.is_account_exists_by_name(params.username);
                    expect(is_path_exists).toBe(true);
                }
            });
        });

        describe('list_users', () => {
            it('list_users return array of users and value of is_truncated (requesting account is root account ' +
                    'on IAM users)', async function() {
                const params = {};
                const account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
                const res = await accountspace_fs.list_users(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(res.members.length).toBeGreaterThan(0);
                expect(res.members.length).toBe(3);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
                for (const member of res.members) {
                    expect(member.arn).toBe(`arn:aws:iam::${owner_account_id}:user${member.iam_path}${member.username}`);
                }
            });

            it('list_users return array of users and value of is_truncated (requesting account is root accounts manager ' +
                    'on accounts)', async function() {
                const params = {};
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                const res = await accountspace_fs.list_users(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(res.members.length).toBeGreaterThan(1); //  will always have at least 1 account (himself)
                expect(typeof res.is_truncated === 'boolean').toBe(true);
                expect(res.members[0].user_id).toBeDefined();
                expect(res.members[0].arn).toBe(`arn:aws:iam::${res.members[0].user_id}:root`);
            });

            it('list_users return an empty array of users and value of is_truncated ' +
                    '(if none of the users has the iam_path_prefix)', async function() {
                const params = {
                    iam_path_prefix: 'non_existing_division/non-existing_subdivision'
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.list_users(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(res.members.length).toBe(0);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
            });

            it('list_users return an array with users that their iam_path starts with iam_path_prefix ' +
                    'and value of is_truncated', async function() {
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

            it('list_users should throw an error if requesting user is not a root account', async function() {
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
            await fs_utils.create_fresh_path(accountspace_fs.config_fs.identities_dir_path);
            await fs_utils.create_fresh_path(accountspace_fs.config_fs.accounts_by_name_dir_path);
            await fs_utils.create_fresh_path(accountspace_fs.config_fs.access_keys_dir_path);
            await fs_utils.create_fresh_path(accountspace_fs.config_fs.buckets_dir_path);
            await fs_utils.create_fresh_path(new_buckets_path1);
            await fs.promises.chown(new_buckets_path1,
                root_user_root_accounts_manager.nsfs_account_config.uid, root_user_root_accounts_manager.nsfs_account_config.gid);

            for (const account of [root_user_root_accounts_manager]) {
                await accountspace_fs.config_fs.create_account_config_file(account);
            }
        });
        afterAll(async () => {
            fs_utils.folder_delete(config_root);
            fs_utils.folder_delete(new_buckets_path1);
        });

        describe('create_access_key', () => {
            it('create_access_key should throw an error if requesting user is not a root account',
                    async function() {
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

            it('create_access_key should throw an error if user account does not exist', async function() {
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

            it('create_access_key should throw an error if user is not owned by the root account', async function() {
                try {
                    const params = {
                        username: dummy_user1.username,
                    };
                    const account_sdk = make_dummy_account_sdk_not_for_creating_resources();
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
                const owner_account_id = account_sdk.requesting_account._id;
                expect(res.username).toBe(dummy_username1);
                expect(res.access_key).toBeDefined();
                expect(res.status).toBe('Active');
                expect(res.secret_key).toBeDefined();

                const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    params.username, owner_account_id, config_fs_account_options);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(1);

                const access_key = res.access_key;
                const user_account_config_file_from_symlink =
                    await accountspace_fs.config_fs.get_account_by_access_key(access_key, config_fs_account_options);
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
                const owner_account_id = account_sdk.requesting_account._id;
                expect(res.username).toBe(dummy_username1);
                expect(res.access_key).toBeDefined();
                expect(res.status).toBe('Active');
                expect(res.secret_key).toBeDefined();

                const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(params.username,
                    owner_account_id, config_fs_account_options);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(2);

                const access_key = res.access_key;
                const user_account_config_file_from_symlink =
                    await accountspace_fs.config_fs.get_account_by_access_key(access_key, config_fs_account_options);
                expect(user_account_config_file_from_symlink.name).toBe(params.username);
                expect(user_account_config_file_from_symlink.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file_from_symlink.access_keys)).toBe(true);
                expect(user_account_config_file_from_symlink.access_keys.length).toBe(2);
            });

            it('create_access_key should throw an error if user already has 2 access keys', async function() {
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
                const owner_account_id = account_sdk.requesting_account._id;
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
                let user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(dummy_username5,
                    owner_account_id, config_fs_account_options);
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

                user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(dummy_username5,
                    owner_account_id, config_fs_account_options);
                expect(user_account_config_file.name).toBe(dummy_username5);
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(2);

                const access_key = res.access_key;
                const user_account_config_file_from_symlink =
                    await accountspace_fs.config_fs.get_account_by_access_key(access_key, config_fs_account_options);
                expect(user_account_config_file_from_symlink.name).toBe(dummy_username5);
                expect(user_account_config_file_from_symlink.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file_from_symlink.access_keys)).toBe(true);
                expect(user_account_config_file_from_symlink.access_keys.length).toBe(2);
            });

            it('create_access_key should throw an error if user is not owned by the root account ' +
                    '(requester is an IAM user)', async function() {
                try {
                    // both IAM users are under the same root account (owner property)
                    let account_sdk = make_dummy_account_sdk();
                    const owner_account_id = account_sdk.requesting_account._id;
                    const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                        dummy_username5, owner_account_id, config_fs_account_options);
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

            it('create_access_key should return user access key params (requesting account is root accounts manager ' +
                    'to create access keys for account)', async function() {
                const username = dummy_user_root_account.username;
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                // create the user
                const params = {
                    username: username,
                };
                await accountspace_fs.create_user(params, account_sdk);
                // create the access key
                const res = await accountspace_fs.create_access_key(params, account_sdk);
                expect(res.username).toBeUndefined(); // in accounts creation we don't return the username (no username, but account name)
                expect(res.access_key).toBeDefined();
                expect(res.status).toBe('Active');
                expect(res.secret_key).toBeDefined();

                const user_account_config_file = await accountspace_fs.config_fs.get_account_by_name(
                    params.username, config_fs_account_options);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(1);

                const access_key = res.access_key;
                const user_account_config_file_from_symlink = await accountspace_fs.config_fs.get_account_by_access_key(access_key,
                    config_fs_account_options);
                expect(user_account_config_file_from_symlink.name).toBe(params.username);
                expect(user_account_config_file_from_symlink.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file_from_symlink.access_keys)).toBe(true);
            });

            it('create_access_key should throw an error if user is IAM user (requesting account is root accounts manager)',
                    async function() {
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
                    // the user is searched under the accounts (and not under the /users specific directory)
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                }
            });
        });

        describe('get_access_key_last_used', () => {
            const dummy_region = 'us-west-2';
            it('get_access_key_last_used should return user access key params (requesting account is root account ' +
                    'to get IAM user access keys)', async function() {
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
                expect(res.username).toBe(params_for_access_key_creation.username);
            });

            it('get_access_key_last_used should throw an error if access key does not exist', async function() {
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

            it('get_access_key_last_used should throw an error if access key exists in another root account',
                    async function() {
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
                const owner_account_id = account_sdk.requesting_account._id;
                const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    username, owner_account_id, config_fs_account_options);
                // by the IAM user
                account_sdk = make_dummy_account_sdk_created_from_another_account(
                    user_account_config_file, user_account_config_file.owner);
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

            it('get_access_key_last_used throw an error if user is not owned by the root account ' +
                    '(requester is an IAM user)', async function() {
                try {
                    let account_sdk = make_dummy_account_sdk();
                    const owner_account_id = account_sdk.requesting_account._id;
                    const requester_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                        dummy_user2.username, owner_account_id, config_fs_account_options);
                    // by the IAM user
                    account_sdk = make_dummy_account_sdk_created_from_another_account(requester_account_config_file,
                        requester_account_config_file.owner);
                    const user_account_config_file = await accountspace_fs.config_fs.get_account_by_name(
                        dummy_user_root_account.username, config_fs_account_options);
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

            it('get_access_key_last_used should return user access key params ' +
                    '(requesting account is root accounts manager requested account is root account)',
                    async function() {
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
                expect(res.username).toBeUndefined(); // in accounts we don't return the username (no username, but account name)
            });
        });

        describe('update_access_key', () => {
            it('update_access_key should throw an error if requesting user is not a root account ' +
                    '(on another user)', async function() {
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

            it('update_access_key should throw an error if access key does not exist', async function() {
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

            it('update_access_key should throw an error if user account does not exist', async function() {
                const account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
                const user_account = await accountspace_fs.config_fs.get_user_by_name(dummy_username1,
                    owner_account_id, config_fs_account_options);
                const dummy_access_key = user_account.access_keys[0].access_key;
                try {
                    const params = {
                        username: 'non-existing-user',
                        access_key: dummy_access_key,
                        status: ACCESS_KEY_STATUS_ENUM.ACTIVE,
                    };
                    await accountspace_fs.update_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                    expect(err.message).toMatch(/user with name/i);
                }
            });

            it('update_access_key should throw an error if access key belongs to a user and not the account ' +
                    '(without passing the username flag)', async function() {
                const account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
                const user_account = await accountspace_fs.config_fs.get_user_by_name(dummy_username1,
                    owner_account_id, config_fs_account_options);
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

            it('update_access_key should throw an error if access key is on another root account', async function() {
                try {
                    const account_sdk = make_dummy_account_sdk_not_for_creating_resources();
                    const owner_account_id = make_dummy_account_sdk().requesting_account._id;
                    const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                        dummy_username1, owner_account_id, config_fs_account_options);
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

            it('update_access_key should not return any param (update status to Inactive) ' +
                '(requesting account is root account to update IAM user access key)', async function() {
                const account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
                let user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    dummy_username1, owner_account_id, config_fs_account_options);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: dummy_username1,
                    access_key: access_key,
                    status: ACCESS_KEY_STATUS_ENUM.INACTIVE,
                };
                const res = await accountspace_fs.update_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(dummy_username1,
                    owner_account_id, config_fs_account_options);
                expect(user_account_config_file.access_keys[0].deactivated).toBe(true);
            });

            it('update_access_key should not return any param (update status to Active) ' +
                '(requesting account is root account to update IAM user access key)', async function() {
                const account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
                let user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    dummy_username1, owner_account_id, config_fs_account_options);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: dummy_username1,
                    access_key: access_key,
                    status: ACCESS_KEY_STATUS_ENUM.ACTIVE,
                };
                const res = await accountspace_fs.update_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    dummy_username1, owner_account_id, config_fs_account_options);
                expect(user_account_config_file.access_keys[0].deactivated).toBe(false);
            });

            it('update_access_key should not return any param (update status to Active, already was Active) ' +
                '(requesting account is root account to update IAM user access key)', async function() {
                const account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
                let user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    dummy_username1, owner_account_id, config_fs_account_options);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: dummy_username1,
                    access_key: access_key,
                    status: ACCESS_KEY_STATUS_ENUM.ACTIVE,
                };
                const res = await accountspace_fs.update_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(dummy_username1,
                    owner_account_id, config_fs_account_options);
                expect(user_account_config_file.access_keys[0].deactivated).toBe(false);
            });

            it('update_access_key should not return any param (requester is an IAM user)', async function() {
                const dummy_username = dummy_username5;
                let account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
                let user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    dummy_username, owner_account_id, config_fs_account_options);
                // by the IAM user
                account_sdk = make_dummy_account_sdk_created_from_another_account(
                    user_account_config_file, user_account_config_file.owner);
                const access_key = user_account_config_file.access_keys[1].access_key;
                const params = {
                    access_key: access_key,
                    status: ACCESS_KEY_STATUS_ENUM.INACTIVE,
                };
                const res = await accountspace_fs.update_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(dummy_username,
                    owner_account_id, config_fs_account_options);
                expect(user_account_config_file.access_keys[1].deactivated).toBe(true);
            });

            it('update_access_key should throw an error if user is not owned by the root account ' +
                '(requester is an IAM user)', async function() {
                try {
                    // both IAM users are under the same root account (owner property)
                    let account_sdk = make_dummy_account_sdk();
                    const owner_account_id = account_sdk.requesting_account._id;
                    const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(dummy_username5,
                        owner_account_id, config_fs_account_options);
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

            it('update_access_key should not return any param (update status to Inactive) ' +
                '(requesting account is root accounts manager requested account is root account)', async function() {
                const username = dummy_user_root_account.username;
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                let user_account_config_file = await accountspace_fs.config_fs.get_account_by_name(
                    username, config_fs_account_options);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: username,
                    access_key: access_key,
                    status: ACCESS_KEY_STATUS_ENUM.INACTIVE,
                };
                const res = await accountspace_fs.update_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await accountspace_fs.config_fs.get_account_by_name(username,
                    config_fs_account_options);
                expect(user_account_config_file.access_keys[0].deactivated).toBe(true);
            });
        });

        describe('delete_access_key', () => {
            it('delete_access_key should throw an error if requesting user is not a root account', async function() {
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

            it('delete_access_key should throw an error if access key does not exist', async function() {
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

            it('delete_access_key should throw an error if user account does not exist', async function() {
                const account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
                const user_account = await accountspace_fs.config_fs.get_user_by_name(dummy_username1,
                    owner_account_id, config_fs_account_options);
                const dummy_access_key = user_account.access_keys[0].access_key;
                try {
                    const params = {
                        username: 'non-existing-user',
                        access_key: dummy_access_key,
                    };
                    await accountspace_fs.delete_access_key(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
                    expect(err.message).toMatch(/user with name/i);
                }
            });

            it('delete_access_key should throw an error if access key belongs to another account ' +
                'without passing the username flag', async function() {
            const account_sdk = make_dummy_account_sdk();
            const owner_account_id = account_sdk.requesting_account._id;
            const user_account = await accountspace_fs.config_fs.get_user_by_name(dummy_username1,
                owner_account_id, config_fs_account_options);
            const dummy_access_key = user_account.access_keys[0].access_key;
            try {
                const params = {
                    // without username of dummy_username1
                    access_key: dummy_access_key,
                };
                await accountspace_fs.delete_access_key(params, account_sdk);
                throw new NoErrorThrownError();
            } catch (err) {
                expect(err).toBeInstanceOf(IamError);
                expect(err).toHaveProperty('code', IamError.NoSuchEntity.code);
            }
        });

            it('delete_access_key should throw an error if access key belongs to user in on another account', async function() {
                try {
                    const account_sdk = make_dummy_account_sdk_not_for_creating_resources();
                    const owner_account_id = make_dummy_account_sdk().requesting_account._id;
                    const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                        dummy_username1, owner_account_id, config_fs_account_options);
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

            it('delete_access_key should not return any param (requesting account is root account ' +
                    'to delete IAM user access key id)', async function() {
                const account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
                let user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    dummy_username1, owner_account_id, config_fs_account_options);

                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: dummy_username1,
                    access_key: access_key,
                };
                const res = await accountspace_fs.delete_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(dummy_username1,
                    owner_account_id, config_fs_account_options);
                expect(user_account_config_file.access_keys.length).toBe(1);
                const is_path_exists = await accountspace_fs.config_fs.is_account_exists_by_access_key(access_key);
                expect(is_path_exists).toBe(false);
            });

            it('delete_access_key should not return any param (account with 2 access keys) ' +
                    '(requesting account is root account to delete IAM user access key id)', async function() {
                const username = dummy_username6;
                const account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
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
                const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    username, owner_account_id, config_fs_account_options);
                expect(user_account_config_file.access_keys.length).toBe(1);
                expect(user_account_config_file.access_keys[0].access_key).toBe(access_key);
                expect(user_account_config_file.access_keys[0].access_key).not.toBe(access_key_to_delete);
                const is_path_exists1 = await accountspace_fs.config_fs.is_account_exists_by_access_key(access_key_to_delete);
                expect(is_path_exists1).toBe(false);
                const is_path_exists2 = await accountspace_fs.config_fs.is_account_exists_by_access_key(access_key);
                expect(is_path_exists2).toBe(true);
            });

            it('delete_access_key should not return any param (requester is an IAM user)', async function() {
                let account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
                let user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(dummy_username5,
                    owner_account_id, config_fs_account_options);
                // by the IAM user
                account_sdk = make_dummy_account_sdk_created_from_another_account(
                    user_account_config_file, user_account_config_file.owner);
                const access_key = user_account_config_file.access_keys[1].access_key;
                const params = {
                    access_key: access_key,
                };
                const res = await accountspace_fs.delete_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(dummy_username1,
                    owner_account_id, config_fs_account_options);
                expect(user_account_config_file.access_keys.length).toBe(1);
                expect(user_account_config_file.access_keys[0].access_key).not.toBe(access_key);
                const is_path_exists = await accountspace_fs.config_fs.is_account_exists_by_access_key(access_key);
                expect(is_path_exists).toBe(false);
            });

            it('delete_access_key should throw an error if user is not owned by the root account ' +
                    '(requester is an IAM user)', async function() {
                try {
                    // both IAM users are under the same root account (owner property)
                    let account_sdk = make_dummy_account_sdk();
                    const owner_account_id = account_sdk.requesting_account._id;
                    const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                        dummy_username5, owner_account_id, config_fs_account_options);
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

            it('delete_access_key should not return any param (requesting account is root accounts manager ' +
                    'requested account is root account)', async function() {
                const username = dummy_user_root_account.username;
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                let user_account_config_file = await accountspace_fs.config_fs.get_account_by_name(username,
                    config_fs_account_options);
                const access_key = user_account_config_file.access_keys[0].access_key;
                const params = {
                    username: username,
                    access_key: access_key,
                };
                const res = await accountspace_fs.delete_access_key(params, account_sdk);
                expect(res).toBeUndefined();
                user_account_config_file = await accountspace_fs.config_fs.get_account_by_name(username,
                    config_fs_account_options);
                expect(user_account_config_file.access_keys.length).toBe(1);
                const is_path_exists = await accountspace_fs.config_fs.is_account_exists_by_access_key(access_key);
                expect(is_path_exists).toBe(false);
            });
        });

        describe('list_access_keys', () => {
            it('list_access_keys return array of access_keys and value of is_truncated ' +
                    '(requesting account is root account and requested account is IAM user)', async function() {
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
                expect(res.username).toBe(params.username);
            });

            it('list_access_keys should throw an error when username does not exists', async function() {
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

            it('list_access_keys should throw an error when username does not exists (in the root account)',
                    async function() {
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

            it('list_access_keys return empty array of access_keys is user does not have access_keys',
                    async function() {
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
                expect(res.username).toBe(params.username);
            });

            it('list_access_keys return array of access_keys and value of is_truncated ' +
                    '(requester is an IAM user)', async function() {
                let account_sdk = make_dummy_account_sdk();
                const owner_account_id = account_sdk.requesting_account._id;
                const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                    dummy_username5, owner_account_id, config_fs_account_options);
                // by the IAM user
                account_sdk = make_dummy_account_sdk_created_from_another_account(
                    user_account_config_file, user_account_config_file.owner);
                const params = {};
                const res = await accountspace_fs.list_access_keys(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
                expect(res.members.length).toBe(1);
            });

            it('list_access_keys should throw an error if user is not owned by the root account ' +
                    '(requester is an IAM user)', async function() {
                try {
                    // both IAM users are under the same root account (owner property)
                    let account_sdk = make_dummy_account_sdk();
                    const owner_account_id = account_sdk.requesting_account._id;
                    const user_account_config_file = await accountspace_fs.config_fs.get_user_by_name(
                        dummy_username5, owner_account_id, config_fs_account_options);
                    const access_key = user_account_config_file.access_keys[0].access_key;
                    // create the second access key
                    // by the IAM user
                    account_sdk = make_dummy_account_sdk_created_from_another_account(
                        user_account_config_file, account_sdk.requesting_account._id);
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

            it('list_access_keys return array of access_keys and value of is_truncated ' +
                    '(requesting account is root accounts manager requested account is root account)', async function() {
                const username = dummy_user_root_account.username;
                const account_sdk = make_dummy_account_sdk_root_accounts_manager();
                const params = {
                    username: username,
                };
                const res = await accountspace_fs.list_access_keys(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
                expect(res.members.length).toBe(1);
                expect(res.members[0].username).toBeUndefined(); // // in accounts we don't return the username (no username, but account name)
                expect(res.members[0].access_key).toBeDefined();
                expect(res.members[0].status).toBeDefined();
                expect(res.members[0].create_date).toBeDefined();
            });
        });
    });
});


async function create_dummy_bucket(account, bucket_name) {
    const bucket_storage_path = path.join(account.nsfs_account_config.new_buckets_path, bucket_name);
    const bucket = _new_bucket_defaults(account, bucket_name, bucket_storage_path);
    await accountspace_fs.config_fs.create_bucket_config_file(bucket);
    const bucket_config_path = accountspace_fs.config_fs.get_bucket_path_by_name(bucket_name);
    return bucket_config_path;
}

// parital copy from bucketspace_fs
function _new_bucket_defaults(account, bucket_name, bucket_storage_path) {
    return {
        _id: '65a8edc9bc5d5bbf9db71c75',
        name: bucket_name,
        owner_account: account._id,
        creation_date: new Date().toISOString(),
        path: bucket_storage_path,
        should_create_underlying_storage: true,
        versioning: 'DISABLED',
    };
}
