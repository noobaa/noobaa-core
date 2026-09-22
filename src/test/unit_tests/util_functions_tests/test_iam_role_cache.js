/* Copyright (C) 2026 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const { RpcError } = require('../../../rpc');
// object_sdk exports the ObjectSDK class as module.exports, with caches as properties
const ObjectSDK = require('../../../sdk/object_sdk');
const { iam_roles_cache } = ObjectSDK;

mocha.describe('iam_roles_cache', function() {
    const owner_account_id = 'owner-123';
    const role_name = 'test_role';
    let num_loads = 0;
    const role = {
        role_id: 'role-id-1',
        role_name,
        iam_path: '/',
        arn: 'arn:aws:iam::owner-123:role/test_role',
        create_date: Date.now(),
        assume_role_policy_document: { statement: [] },
    };

    const mock_bucketspace = {
        read_role_by_name: async ({ role_name: name, owner_account_id: account_id }) => {
            num_loads += 1;
            assert.strictEqual(name, role_name);
            assert.strictEqual(account_id, owner_account_id);
            return role;
        },
    };

    mocha.beforeEach(function() {
        num_loads = 0;
        iam_roles_cache.invalidate({ role_name, owner_account_id });
        iam_roles_cache.invalidate({ role_name, owner_account_id: 'other-owner' });
    });

    mocha.it('should load role on cache miss', async function() {
        const result = await iam_roles_cache.get_with_cache({
            bucketspace: mock_bucketspace,
            role_name,
            owner_account_id,
        });
        assert.deepStrictEqual(result, role);
        assert.strictEqual(num_loads, 1);
    });

    mocha.it('should return cached role without reloading', async function() {
        await iam_roles_cache.get_with_cache({ bucketspace: mock_bucketspace, role_name, owner_account_id });
        const result = await iam_roles_cache.get_with_cache({ bucketspace: mock_bucketspace, role_name, owner_account_id });
        assert.deepStrictEqual(result, role);
        assert.strictEqual(num_loads, 1);
    });

    mocha.it('should load separately when owner_account_id differs', async function() {
        const other_role = { ...role, role_id: 'role-id-other' };
        await iam_roles_cache.get_with_cache({ bucketspace: mock_bucketspace, role_name, owner_account_id });
        const other_owner_bucketspace = {
            read_role_by_name: async ({ owner_account_id: account_id }) => {
                num_loads += 1;
                assert.strictEqual(account_id, 'other-owner');
                return other_role;
            },
        };
        const result = await iam_roles_cache.get_with_cache({
            bucketspace: other_owner_bucketspace,
            role_name,
            owner_account_id: 'other-owner',
        });
        assert.deepStrictEqual(result, other_role);
        assert.strictEqual(num_loads, 2);
    });

    mocha.it('should reload role after invalidation', async function() {
        await iam_roles_cache.get_with_cache({ bucketspace: mock_bucketspace, role_name, owner_account_id });
        iam_roles_cache.invalidate({ role_name, owner_account_id });
        await iam_roles_cache.get_with_cache({ bucketspace: mock_bucketspace, role_name, owner_account_id });
        assert.strictEqual(num_loads, 2);
    });
});

mocha.describe('ObjectSDK.get_iam_role_by_name', function() {
    const owner_account_id = 'owner-789';
    const role_name = 'my_role';
    let num_loads = 0;
    const role = {
        role_id: 'role-id-4',
        role_name,
        iam_path: '/',
        arn: `arn:aws:iam::${owner_account_id}:role/${role_name}`,
        create_date: Date.now(),
        assume_role_policy_document: { statement: [] },
    };

    const mock_bucketspace = {
        read_role_by_name: async ({ role_name: name, owner_account_id: account_id }) => {
            num_loads += 1;
            assert.strictEqual(name, role_name);
            assert.strictEqual(account_id, owner_account_id);
            return role;
        },
    };

    let object_sdk;

    mocha.beforeEach(function() {
        num_loads = 0;
        iam_roles_cache.invalidate({ role_name, owner_account_id });
        object_sdk = new ObjectSDK({
            rpc_client: {},
            internal_rpc_client: {},
            object_io: {},
            bucketspace: mock_bucketspace,
        });
    });

    mocha.it('should load role through ObjectSDK on cache miss', async function() {
        const result = await object_sdk.get_iam_role_by_name(role_name, owner_account_id);
        assert.deepStrictEqual(result, role);
        assert.strictEqual(num_loads, 1);
    });

    mocha.it('should serve get_iam_role_by_name from cache without reloading', async function() {
        await object_sdk.get_iam_role_by_name(role_name, owner_account_id);
        const result = await object_sdk.get_iam_role_by_name(role_name, owner_account_id);
        assert.deepStrictEqual(result, role);
        assert.strictEqual(num_loads, 1);
    });

    mocha.it('should throw when owner_account_id is missing', async function() {
        await assert.rejects(
            () => object_sdk.get_iam_role_by_name(role_name),
            err => err instanceof RpcError && err.rpc_code === 'UNAUTHORIZED',
        );
        assert.strictEqual(num_loads, 0);
    });
});
