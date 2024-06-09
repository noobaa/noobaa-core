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
const { IAM_DEFAULT_PATH } = require('../../../endpoint/iam/iam_utils');
const fs_utils = require('../../../util/fs_utils');
const { IamError } = require('../../../endpoint/iam/iam_errors');
const nc_mkm = require('../../../manage_nsfs/nc_master_key_manager').get_instance();

class NoErrorThrownError extends Error {}

const DEFAULT_FS_CONFIG = get_process_fs_context();
const tmp_fs_path = path.join(TMP_PATH, 'test_accountspace_fs');
const config_root = path.join(tmp_fs_path, 'config_root');
const new_buckets_path1 = path.join(tmp_fs_path, 'new_buckets_path1', '/');
const new_buckets_path2 = path.join(tmp_fs_path, 'new_buckets_path2', '/');

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
                    secret_key: new SensitiveString(root_user_account.access_keys[0].secret_key)
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


describe('Accountspace_FS tests', () => {

    beforeAll(async () => {
        await fs_utils.create_fresh_path(accountspace_fs.accounts_dir);
        await fs_utils.create_fresh_path(accountspace_fs.access_keys_dir);
        await fs_utils.create_fresh_path(accountspace_fs.buckets_dir);
        await fs_utils.create_fresh_path(new_buckets_path1);
        await fs.promises.chown(new_buckets_path1, root_user_account.nsfs_account_config.uid, root_user_account.nsfs_account_config.gid);

        for (const account of [root_user_account]) {
            const account_path = accountspace_fs._get_account_config_path(account.name);
            // assuming that the root account has only 1 access key in the 0 index
            const account_access_path = accountspace_fs._get_access_keys_config_path(account.access_keys[0].access_key);
            await fs.promises.writeFile(account_path, JSON.stringify(account));
            await fs.promises.chmod(account_path, 0o600);
            await fs.promises.symlink(account_path, account_access_path);
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
        const dummy_user1 = {
            username: dummy_username1,
            iam_path: dummy_iam_path,
        };
        const dummy_user2 = {
            username: dummy_username2,
            iam_path: dummy_iam_path,
        };

        describe('create_user', () => {
            it('create_user should return user params', async function() {
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

                const user_account_config_file = await read_config_file(accountspace_fs.accounts_dir, params.username);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file._id).toBeDefined();
                expect(user_account_config_file.creation_date).toBeDefined();
                expect(user_account_config_file.access_keys).toBeDefined();
                expect(Array.isArray(user_account_config_file.access_keys)).toBe(true);
                expect(user_account_config_file.access_keys.length).toBe(0);
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
                    expect(err).toHaveProperty('code', IamError.AccessDenied.code);
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
            it('get_user should return user params', async function() {
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
                    expect(err).toHaveProperty('code', IamError.AccessDenied.code);
                }
            });

            it('get_user should return an error if user to get is a root account user', async function() {
                try {
                    const params = {
                        username: root_user_account.name,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.get_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDenied.code);
                }
            });

            it('get_user should return an error if user account does not exists', async function() {
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

                const user_account_config_file = await read_config_file(accountspace_fs.accounts_dir, params.username);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.iam_path).toBe(dummy_user1.iam_path);
            });

            it('update_user with new_iam_path should return user params and update the iam_path', async function() {
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
                const user_account_config_file = await read_config_file(accountspace_fs.accounts_dir, params.username);
                expect(user_account_config_file.name).toBe(params.username);
                expect(user_account_config_file.iam_path).toBe(dummy_iam_path2);
                // back as it was
                params = {
                    username: dummy_user1.username,
                    new_iam_path: dummy_user1.iam_path,
                };
                await accountspace_fs.update_user(params, account_sdk);
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
                    expect(err).toHaveProperty('code', IamError.AccessDenied.code);
                }
            });

            it('update_user should return an error if user to update is a root account user', async function() {
                try {
                    const params = {
                        username: root_user_account.name,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.update_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDenied.code);
                }
            });

            it('update_user should return an error if user account does not exists', async function() {
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

            it('update_user with new_username should return an error if username already exists', async function() {
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
                const user_account_config_file = await read_config_file(accountspace_fs.accounts_dir, params.new_username);
                expect(user_account_config_file.name).toBe(params.new_username);
                // back as it was
                params = {
                    username: dummy_user2_new_username,
                    new_username: dummy_user2.username,
                };
                await accountspace_fs.update_user(params, account_sdk);
            });
        });

        describe('delete_user', () => {
            it('delete_user does not return any params', async function() {
                const params = {
                    username: dummy_user1.username,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.delete_user(params, account_sdk);
                expect(res).toBeUndefined();
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
                    expect(err).toHaveProperty('code', IamError.AccessDenied.code);
                }
            });

            it('delete_user should return an error if user to delete is a root account user', async function() {
                try {
                    const params = {
                        username: root_user_account.name,
                    };
                    const account_sdk = make_dummy_account_sdk();
                    await accountspace_fs.delete_user(params, account_sdk);
                    throw new NoErrorThrownError();
                } catch (err) {
                    expect(err).toBeInstanceOf(IamError);
                    expect(err).toHaveProperty('code', IamError.AccessDenied.code);
                }
            });

            it('delete_user should return an error if user account does not exists', async function() {
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

            it.skip('delete_user should return an error if user has access keys', async function() {
                // TODO after implementing create_access_key
            });
        });

        describe('list_users', () => {
            it('list_users return array of users and value of is_truncated', async function() {
                const params = {};
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.list_users(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(res.members.length).toBeGreaterThan(0);
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
                    expect(err).toHaveProperty('code', IamError.AccessDenied.code);
                }
            });
        });
    });

    describe('Accountspace_FS Access Keys tests', () => {
        const dummy_username1 = 'Bob';
        describe('create_access_key', () => {
            it('create_access_key should return user access key params', async function() {
                const params = {
                    username: dummy_username1,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.create_access_key(params, account_sdk);
                expect(res.username).toBe(dummy_username1);
                expect(res.access_key).toBeDefined();
                expect(res.status).toBe('Active');
                expect(res.secret_key).toBeDefined();
            });
        });

        describe('get_access_key_last_used', () => {
            it('get_access_key_last_used should return user access key params', async function() {
                const params = {
                    username: dummy_username1,
                };
                const dummy_region = 'us-west-2';
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.get_access_key_last_used(params, account_sdk);
                expect(res.region).toBe(dummy_region);
                expect(res).toHaveProperty('last_used_date');
                expect(res).toHaveProperty('service_name');
                expect(res.username).toBe(dummy_username1);
            });
        });

        describe('update_access_key', () => {
            it('update_access_key does not return any param', async function() {
                const params = {
                    username: dummy_username1,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.update_access_key(params, account_sdk);
                expect(res).toBeUndefined();
            });
        });

        describe('delete_access_key', () => {
            it('delete_access_key does not return any params', async function() {
                const params = {
                    username: dummy_username1,
                };
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.delete_access_key(params, account_sdk);
                expect(res).toBeUndefined();
            });
        });

        describe('list_access_keys', () => {
            it('list_access_keys return array of users and value of is_truncated', async function() {
                const params = {};
                const account_sdk = make_dummy_account_sdk();
                const res = await accountspace_fs.list_users(params, account_sdk);
                expect(Array.isArray(res.members)).toBe(true);
                expect(typeof res.is_truncated === 'boolean').toBe(true);
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
