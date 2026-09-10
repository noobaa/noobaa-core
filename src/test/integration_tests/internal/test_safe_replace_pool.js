/* Copyright (C) 2016 NooBaa */
'use strict';

const coretest = require('../../utils/coretest/coretest');
coretest.setup();

const mocha = require('mocha');
const assert = require('assert');

mocha.describe('safe_replace_pool', function() {

    const { rpc_client, POOL_LIST } = coretest;
    // POOL_LIST[0] is attached to first.bucket and set as account default by setup_pools.
    // POOL_LIST[1] is unreferenced, so we use it as OTHER_POOL for safe no-op assertions.
    const DEFAULT_POOL_NAME = POOL_LIST[0].name;
    const OTHER_POOL = POOL_LIST[1].name;
    const PREFIX = 'safe-replace';

    mocha.it('setup pools', async function() {
        this.timeout(300000); // eslint-disable-line no-invalid-this
        await coretest.setup_pools(coretest.POOL_LIST);
    });

    mocha.it('rejects non-existent old pool', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        try {
            await rpc_client.pool.safe_replace_pool({
                old_pool_name: 'no-such-pool',
                new_pool_name: DEFAULT_POOL_NAME,
            });
            assert.fail('should fail with NO_SUCH_POOL');
        } catch (err) {
            assert.strictEqual(err.rpc_code, 'NO_SUCH_POOL');
        }
    });

    mocha.it('rejects non-existent new pool', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        try {
            await rpc_client.pool.safe_replace_pool({
                old_pool_name: DEFAULT_POOL_NAME,
                new_pool_name: 'no-such-pool',
            });
            assert.fail('should fail with NO_SUCH_POOL');
        } catch (err) {
            assert.strictEqual(err.rpc_code, 'NO_SUCH_POOL');
        }
    });

    mocha.it('rejects same pool for old and new', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        try {
            await rpc_client.pool.safe_replace_pool({
                old_pool_name: DEFAULT_POOL_NAME,
                new_pool_name: DEFAULT_POOL_NAME,
            });
            assert.fail('should fail with BAD_REQUEST');
        } catch (err) {
            assert.strictEqual(err.rpc_code, 'BAD_REQUEST');
        }
    });

    mocha.it('returns zero when no tiers reference old pool', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        const reply = await rpc_client.pool.safe_replace_pool({
            old_pool_name: OTHER_POOL,
            new_pool_name: DEFAULT_POOL_NAME,
        });
        assert.strictEqual(reply.replaced_tiers, 0);
        assert.strictEqual(reply.updated_accounts, 0);
        assert.strictEqual(reply.mode, 'REPLACED');
    });

    mocha.it('migrate mode adds mirror to tier', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        const REPLACE_TIER = `${PREFIX}-replace-tier`;
        const REPLACE_BUCKET = `${PREFIX}-replace-bucket`;
        const REPLACE_POLICY = `${PREFIX}-replace-policy`;

        await rpc_client.tier.create_tier({
            name: REPLACE_TIER,
            attached_pools: [DEFAULT_POOL_NAME],
            data_placement: 'SPREAD',
        });
        await rpc_client.tiering_policy.create_policy({
            name: REPLACE_POLICY,
            tiers: [{ order: 0, tier: REPLACE_TIER, spillover: false, disabled: false }],
        });
        await rpc_client.bucket.create_bucket({
            name: REPLACE_BUCKET,
            tiering: REPLACE_POLICY,
        });

        const reply = await rpc_client.pool.safe_replace_pool({
            old_pool_name: DEFAULT_POOL_NAME,
            new_pool_name: OTHER_POOL,
            enable_migration: true,
        });
        assert.strictEqual(reply.mode, 'MIRROR_STARTED');
        assert(reply.replaced_tiers >= 1, 'expected at least 1 replaced tier');

        const tier_info = await rpc_client.tier.read_tier({ name: REPLACE_TIER });
        assert.strictEqual(tier_info.data_placement, 'MIRROR');
        assert(tier_info.attached_pools.includes(DEFAULT_POOL_NAME),
            'tier should still have old pool during migration');
        assert(tier_info.attached_pools.includes(OTHER_POOL),
            'tier should have new pool added as mirror');

        // Second migrate call should be idempotent
        const reply2 = await rpc_client.pool.safe_replace_pool({
            old_pool_name: DEFAULT_POOL_NAME,
            new_pool_name: OTHER_POOL,
            enable_migration: true,
        });
        assert.strictEqual(reply2.replaced_tiers, 0, 'second migrate call should be no-op');

        // Finalize: replace to only OTHER_POOL
        const reply3 = await rpc_client.pool.safe_replace_pool({
            old_pool_name: DEFAULT_POOL_NAME,
            new_pool_name: OTHER_POOL,
        });
        assert.strictEqual(reply3.mode, 'REPLACED');
        assert(reply3.replaced_tiers >= 1, 'expected at least 1 replaced tier on finalize');

        const tier_info2 = await rpc_client.tier.read_tier({ name: REPLACE_TIER });
        assert.strictEqual(tier_info2.data_placement, 'SPREAD');
        assert.deepStrictEqual(tier_info2.attached_pools, [OTHER_POOL]);

        await rpc_client.bucket.delete_bucket({ name: REPLACE_BUCKET });
    });

    mocha.it('updates account default_resource', async function() {
        this.timeout(90000); // eslint-disable-line no-invalid-this
        const REPLACE_ACCOUNT = `${PREFIX}-account@test.com`;

        await rpc_client.account.create_account({
            name: REPLACE_ACCOUNT,
            email: REPLACE_ACCOUNT,
            has_login: false,
            s3_access: true,
            default_resource: DEFAULT_POOL_NAME,
        });

        let account = await rpc_client.account.read_account({ email: REPLACE_ACCOUNT });
        assert.strictEqual(account.default_resource, DEFAULT_POOL_NAME);

        const reply = await rpc_client.pool.safe_replace_pool({
            old_pool_name: DEFAULT_POOL_NAME,
            new_pool_name: OTHER_POOL,
        });
        assert(reply.updated_accounts >= 1, 'expected at least 1 updated account');

        account = await rpc_client.account.read_account({ email: REPLACE_ACCOUNT });
        assert.strictEqual(account.default_resource, OTHER_POOL);

        await rpc_client.account.update_account_s3_access({
            email: REPLACE_ACCOUNT,
            s3_access: true,
            default_resource: DEFAULT_POOL_NAME,
        });
        await rpc_client.account.delete_account({ email: REPLACE_ACCOUNT });
    });
});
