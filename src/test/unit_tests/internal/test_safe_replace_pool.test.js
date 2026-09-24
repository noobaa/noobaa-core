/* Copyright (C) 2016 NooBaa */
/* eslint max-lines-per-function: ['error', 600] */
'use strict';

const MockObjectId = require('mongodb').ObjectId;

jest.mock('../../../../config', () => ({
    DB_TYPE: 'mongodb',
    NODES_FREE_SPACE_RESERVE: 0,
    NODES_FREE_SPACE_RESERVE_PERCENTAGE: 0,
    CHUNK_SPLIT_AVG_CHUNK: 1,
    CHUNK_SPLIT_DELTA_CHUNK: 1,
    CHUNK_CODER_FRAG_DIGEST_TYPE: 'sha384',
    CHUNK_CODER_DIGEST_TYPE: 'sha384',
    CHUNK_CODER_COMPRESS_TYPE: 'snappy',
    CHUNK_CODER_CIPHER_TYPE: 'aes-256-gcm',
    CHUNK_CODER_REPLICAS: 1,
    CHUNK_CODER_EC_DATA_FRAGS: 0,
    CHUNK_CODER_EC_PARITY_FRAGS: 0,
    CHUNK_CODER_EC_PARITY_TYPE: '',
    CHUNK_CODER_EC_IS_CM: false,
    FUNC_STORE_FS_PATH: '/tmp/test_funcs',
    CENTRAL_STATS: false,
    BASE_ADDRESS: 'ws://localhost',
}));

jest.mock('../../../util/db_client', () => {
    const noop = () => ({});
    const handler = { get: () => noop };
    return { instance: () => new Proxy({}, handler) };
});

jest.mock('../../../util/debug_module', () => {
    const fake = () => undefined;
    return () => ({
        set_module_level: fake,
        log0: fake, log1: fake, log2: fake, log3: fake, log4: fake,
        warn: fake, error: fake, trace: fake,
    });
});

const mock_make_changes = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../server/system_services/system_store', () => {
    let mock_data = { tiers: [], accounts: [] };
    const mock_store = {
        get data() { return mock_data; },
        make_changes: mock_make_changes,
        new_system_store_id: () => new MockObjectId(),
    };
    return {
        get_instance: () => mock_store,
        __set_mock_data(data) { mock_data = data; },
    };
});

jest.mock('../../../server/notifications/dispatcher', () => ({
    instance: () => ({
        activity: jest.fn(),
    }),
}));

jest.mock('../../../server/node_services/nodes_client', () => ({}));
jest.mock('../../../server/server_rpc', () => ({ client: {} }));
jest.mock('../../../server/common_services/auth_server', () => ({}));
jest.mock('../../../server/analytic_services/history_data_store', () => ({ HistoryDataStore: {} }));
jest.mock('../../../server/analytic_services/io_stats_store', () => ({ IoStatsStore: {} }));
jest.mock('../../../server/system_services/pool_controllers', () => ({}));
jest.mock('../../../server/kube-store', () => ({ KubeStore: {} }));
jest.mock('../../../sdk/noobaa_s3_client/noobaa_s3_client', () => ({}));
jest.mock('../../../util/cloud_utils', () => ({}));

const pool_server = require('../../../server/system_services/pool_server');
const system_store_module = require('../../../server/system_services/system_store');

const SYSTEM_ID = new MockObjectId();
const OLD_POOL_ID = new MockObjectId();
const NEW_POOL_ID = new MockObjectId();
const UNRELATED_POOL_ID = new MockObjectId();
const TIER_ID_1 = new MockObjectId();
const MIRROR_ID_1 = new MockObjectId();
const MIRROR_ID_2 = new MockObjectId();
const ACCOUNT_ID_1 = new MockObjectId();
const ACCOUNT_ID_2 = new MockObjectId();

function make_req(params) {
    return {
        rpc_params: params,
        system: {
            _id: SYSTEM_ID,
            pools_by_name: {
                'old-pool': { _id: OLD_POOL_ID, name: 'old-pool' },
                'new-pool': { _id: NEW_POOL_ID, name: 'new-pool' },
                'unrelated-pool': { _id: UNRELATED_POOL_ID, name: 'unrelated-pool' },
            },
        },
        account: { _id: new MockObjectId() },
    };
}

function set_mock_data({ tiers = [], accounts = [] } = {}) {
    system_store_module.__set_mock_data({ tiers, accounts });
}

beforeEach(() => {
    set_mock_data();
    mock_make_changes.mockClear();
});

describe('safe_replace_pool', () => {

    describe('validation', () => {
        it('rejects non-existent old pool', async () => {
            const req = make_req({ old_pool_name: 'no-such', new_pool_name: 'new-pool' });
            await expect(pool_server.safe_replace_pool(req))
                .rejects.toMatchObject({ rpc_code: 'NO_SUCH_POOL' });
        });

        it('rejects non-existent new pool', async () => {
            const req = make_req({ old_pool_name: 'old-pool', new_pool_name: 'no-such' });
            await expect(pool_server.safe_replace_pool(req))
                .rejects.toMatchObject({ rpc_code: 'NO_SUCH_POOL' });
        });

        it('rejects same pool for old and new', async () => {
            const req = make_req({ old_pool_name: 'old-pool', new_pool_name: 'old-pool' });
            await expect(pool_server.safe_replace_pool(req))
                .rejects.toMatchObject({ rpc_code: 'BAD_REQUEST' });
        });
    });

    describe('no-op', () => {
        it('returns zero when no tiers or accounts reference old pool', async () => {
            set_mock_data({ tiers: [], accounts: [] });
            const req = make_req({ old_pool_name: 'old-pool', new_pool_name: 'new-pool' });
            const reply = await pool_server.safe_replace_pool(req);
            expect(reply.replaced_tiers).toBe(0);
            expect(reply.updated_accounts).toBe(0);
            expect(reply.mode).toBe('REPLACED');
        });
    });

    describe('account-only replacement', () => {
        it('updates accounts when no tiers reference old pool', async () => {
            set_mock_data({
                tiers: [],
                accounts: [{
                    _id: ACCOUNT_ID_1,
                    email: 'test@test.com',
                    default_resource: { _id: OLD_POOL_ID },
                }],
            });
            const req = make_req({ old_pool_name: 'old-pool', new_pool_name: 'new-pool' });
            const reply = await pool_server.safe_replace_pool(req);
            expect(reply.replaced_tiers).toBe(0);
            expect(reply.updated_accounts).toBe(1);
            const changes = mock_make_changes.mock.calls[0][0];
            expect(changes.update.accounts).toEqual([
                { _id: ACCOUNT_ID_1, default_resource: NEW_POOL_ID },
            ]);
        });
    });

    describe('migration mode', () => {
        it('adds new pool as mirror group', async () => {
            set_mock_data({
                tiers: [{
                    _id: TIER_ID_1,
                    system: { _id: SYSTEM_ID },
                    mirrors: [{ _id: MIRROR_ID_1, spread_pools: [{ _id: OLD_POOL_ID }] }],
                }],
            });
            const req = make_req({
                old_pool_name: 'old-pool', new_pool_name: 'new-pool', enable_migration: true,
            });
            const reply = await pool_server.safe_replace_pool(req);
            expect(reply.mode).toBe('MIRROR_STARTED');
            expect(reply.replaced_tiers).toBe(1);
            const changes = mock_make_changes.mock.calls[0][0];
            const tier_update = changes.update.tiers[0];
            expect(tier_update.data_placement).toBe('MIRROR');
            expect(tier_update.mirrors).toHaveLength(2);
            expect(tier_update.mirrors[1].spread_pools).toEqual([NEW_POOL_ID]);
        });

        it('skips tier that already has new pool (idempotent)', async () => {
            set_mock_data({
                tiers: [{
                    _id: TIER_ID_1,
                    system: { _id: SYSTEM_ID },
                    mirrors: [
                        { _id: MIRROR_ID_1, spread_pools: [{ _id: OLD_POOL_ID }] },
                        { _id: MIRROR_ID_2, spread_pools: [{ _id: NEW_POOL_ID }] },
                    ],
                }],
            });
            const req = make_req({
                old_pool_name: 'old-pool', new_pool_name: 'new-pool', enable_migration: true,
            });
            const reply = await pool_server.safe_replace_pool(req);
            expect(reply.replaced_tiers).toBe(0);
        });
    });

    describe('direct replacement', () => {
        it('swaps old pool for new pool in mirror group', async () => {
            set_mock_data({
                tiers: [{
                    _id: TIER_ID_1,
                    system: { _id: SYSTEM_ID },
                    mirrors: [{ _id: MIRROR_ID_1, spread_pools: [{ _id: OLD_POOL_ID }] }],
                }],
            });
            const req = make_req({ old_pool_name: 'old-pool', new_pool_name: 'new-pool' });
            const reply = await pool_server.safe_replace_pool(req);
            expect(reply.mode).toBe('REPLACED');
            expect(reply.replaced_tiers).toBe(1);
            const changes = mock_make_changes.mock.calls[0][0];
            const tier_update = changes.update.tiers[0];
            expect(tier_update.data_placement).toBe('SPREAD');
            expect(tier_update.mirrors).toHaveLength(1);
            expect(tier_update.mirrors[0].spread_pools).toEqual([NEW_POOL_ID]);
        });

        it('preserves unrelated pools in the same mirror group', async () => {
            set_mock_data({
                tiers: [{
                    _id: TIER_ID_1,
                    system: { _id: SYSTEM_ID },
                    mirrors: [{
                        _id: MIRROR_ID_1,
                        spread_pools: [{ _id: OLD_POOL_ID }, { _id: UNRELATED_POOL_ID }],
                    }],
                }],
            });
            const req = make_req({ old_pool_name: 'old-pool', new_pool_name: 'new-pool' });
            await pool_server.safe_replace_pool(req);
            const changes = mock_make_changes.mock.calls[0][0];
            const tier_update = changes.update.tiers[0];
            expect(tier_update.mirrors[0].spread_pools).toEqual(
                expect.arrayContaining([UNRELATED_POOL_ID, NEW_POOL_ID])
            );
            expect(tier_update.mirrors[0].spread_pools).not.toEqual(
                expect.arrayContaining([OLD_POOL_ID])
            );
        });

        it('normalizes untouched mirror groups to raw IDs', async () => {
            set_mock_data({
                tiers: [{
                    _id: TIER_ID_1,
                    system: { _id: SYSTEM_ID },
                    mirrors: [
                        { _id: MIRROR_ID_1, spread_pools: [{ _id: OLD_POOL_ID }] },
                        { _id: MIRROR_ID_2, spread_pools: [{ _id: UNRELATED_POOL_ID }] },
                    ],
                }],
            });
            const req = make_req({ old_pool_name: 'old-pool', new_pool_name: 'new-pool' });
            await pool_server.safe_replace_pool(req);
            const changes = mock_make_changes.mock.calls[0][0];
            const tier_update = changes.update.tiers[0];
            const untouched = tier_update.mirrors.find(m =>
                String(m._id) === String(MIRROR_ID_2)
            );
            expect(untouched.spread_pools).toEqual([UNRELATED_POOL_ID]);
        });

        it('avoids duplicate new_pool when already in another mirror group', async () => {
            set_mock_data({
                tiers: [{
                    _id: TIER_ID_1,
                    system: { _id: SYSTEM_ID },
                    mirrors: [
                        { _id: MIRROR_ID_1, spread_pools: [{ _id: OLD_POOL_ID }] },
                        { _id: MIRROR_ID_2, spread_pools: [{ _id: NEW_POOL_ID }] },
                    ],
                }],
            });
            const req = make_req({ old_pool_name: 'old-pool', new_pool_name: 'new-pool' });
            await pool_server.safe_replace_pool(req);
            const changes = mock_make_changes.mock.calls[0][0];
            const tier_update = changes.update.tiers[0];
            // old_pool group becomes empty and is filtered out
            expect(tier_update.mirrors).toHaveLength(1);
            expect(tier_update.mirrors[0].spread_pools).toEqual([NEW_POOL_ID]);
        });

        it('updates accounts alongside tiers', async () => {
            set_mock_data({
                tiers: [{
                    _id: TIER_ID_1,
                    system: { _id: SYSTEM_ID },
                    mirrors: [{ _id: MIRROR_ID_1, spread_pools: [{ _id: OLD_POOL_ID }] }],
                }],
                accounts: [
                    { _id: ACCOUNT_ID_1, email: 'a@test.com', default_resource: { _id: OLD_POOL_ID } },
                    { _id: ACCOUNT_ID_2, email: 'b@test.com', default_resource: { _id: NEW_POOL_ID } },
                ],
            });
            const req = make_req({ old_pool_name: 'old-pool', new_pool_name: 'new-pool' });
            const reply = await pool_server.safe_replace_pool(req);
            expect(reply.replaced_tiers).toBe(1);
            expect(reply.updated_accounts).toBe(1);
            const changes = mock_make_changes.mock.calls[0][0];
            expect(changes.update.accounts).toEqual([
                { _id: ACCOUNT_ID_1, default_resource: NEW_POOL_ID },
            ]);
        });
    });
});
