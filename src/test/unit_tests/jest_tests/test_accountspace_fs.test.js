/* Copyright (C) 2024 NooBaa */
'use strict';

/*
 * This file is written as a part of TDD (Test Driven Development)
 * The asserts reflects the current state of implementation (not final)
 */

const path = require('path');
const SensitiveString = require('../../../util/sensitive_string');
const AccountSpaceFS = require('../../../sdk/accountspace_fs');
const { TMP_PATH } = require('../../system_tests/test_utils');

const tmp_fs_path = path.join(TMP_PATH, 'test_accountspace_fs');
const config_root = path.join(tmp_fs_path, 'config_root');
const new_buckets_path = path.join(tmp_fs_path, 'new_buckets_path', '/');

const accountspace_fs = new AccountSpaceFS({ config_root });

// I'm only interested in the requesting_account field
function make_dummy_account_sdk() {
    return {
        requesting_account: {
            _id: '65b3c68b59ab67b16f98c26e',
            name: new SensitiveString('user2'),
            email: new SensitiveString('user2@noobaa.io'),
            allow_bucket_creation: true,
            nsfs_account_config: {
                uid: 1001,
                gid: 1001,
                new_buckets_path: new_buckets_path,
            },
            master_key_id: '65a62e22ceae5e5f1a758123',
        },
    };
}

describe('Accountspace_FS Users tests', () => {
    const dummy_path = '/division_abc/subdivision_xyz/';
    const dummy_username1 = 'Bob';
    const dummy_user1 = {
        username: dummy_username1,
        path: dummy_path,
    };

    describe('create_user', () => {
        it('create_user should return user params', async function() {
            const params = {
                username: dummy_user1.username,
                path: dummy_user1.path,
            };
            const account_sdk = make_dummy_account_sdk();
            const res = await accountspace_fs.create_user(params, account_sdk);
            expect(res.path).toBe(dummy_user1.path);
            expect(res.username).toBe(dummy_user1.username);
            expect(res.user_id).toBeDefined();
            expect(res.arn).toBeDefined();
            expect(res.create_date).toBeDefined();
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
            expect(res.path).toBe(dummy_user1.path);
            expect(res.username).toBe(dummy_user1.username);
            expect(res.arn).toBeDefined();
            expect(res.create_date).toBeDefined();
            expect(res.password_last_used).toBeDefined();
        });
    });

    describe('update_user', () => {
        it('update_user should return user params', async function() {
            const params = {
                username: dummy_user1.username,
            };
            const account_sdk = make_dummy_account_sdk();
            const res = await accountspace_fs.update_user(params, account_sdk);
            expect(res.path).toBe(dummy_user1.path);
            expect(res.username).toBe(dummy_user1.username);
            expect(res.user_id).toBeDefined();
            expect(res.arn).toBeDefined();
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
    });

    describe('list_users', () => {
        it('list_users return array of users and value of is_truncated', async function() {
            const params = {};
            const account_sdk = make_dummy_account_sdk();
            const res = await accountspace_fs.list_users(params, account_sdk);
            expect(Array.isArray(res.members)).toBe(true);
            expect(typeof res.is_truncated === 'boolean').toBe(true);
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
