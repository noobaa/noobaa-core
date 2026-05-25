/* Copyright (C) 2026 NooBaa */
'use strict';

process.env.DISABLE_INIT_RANDOM_SEED = 'true';

jest.mock('../../../../config', () => ({
    PROMETHEUS_ENABLED: true,
    PROMETHEUS_PREFIX: 'NooBaa_',
}));
jest.mock('../../../util/debug_module', () => () => ({
    set_module_level: () => undefined,
    log0: () => undefined,
    log1: () => undefined,
    log2: () => undefined,
    warn: () => undefined,
    error: () => undefined,
}));

const SensitiveString = require('../../../util/sensitive_string');
const { NooBaaCoreReport } = require('../../../server/analytic_services/prometheus_reports/noobaa_core_report');

const mock_get_all_replication_configs = jest.fn();
jest.mock('../../../server/system_services/replication_store', () => ({
    instance: () => ({ get_all_replication_configs: mock_get_all_replication_configs }),
}));

const mock_store = { buckets: [], deleted: new Map(),
    get_by_id(id) { return this.buckets.find(doc => String(doc._id) === String(id)); },
    get_by_id_include_deleted(id, col) {
        if (col !== 'buckets') return null;
        const live = this.get_by_id(id);
        if (live) return { record: live };
        const d = this.deleted.get(String(id));
        return d ? { record: d } : null;
    },
};
jest.mock('../../../server/system_services/system_store', () => ({ get_instance: () => ({ data: mock_store }) }));
jest.mock('../../../server/common_services/auth_server', () => ({ make_auth_token: () => ({ token: 't' }) }));

const mock_core = jest.fn();
jest.mock('../../../server/analytic_services/prometheus_reporting', () => ({ get_core_report: () => mock_core() }));

const u = require('../../../server/utils/replication_utils');
const DST = 'dst-a'; const R1 = 'repl-1'; const R2 = 'repl-2'; const
SRC = 'src-bucket';
const b = ({ _id, name, replication_policy_id, deleting }) => ({
    _id: String(_id), name: new SensitiveString(name), replication_policy_id, deleting,
});

let report;
const g = () => report._metrics.replication_target_status;
const reset = () => { const h = g()?.hashMap; g()?.reset?.(); Object.keys(h || {}).forEach(k => delete h[k]); };
const tgts = r => Object.values(g().hashMap).filter(e => e.labels?.replication_id === String(r)).map(e => e.labels.target_bucket);
const probe = (r, s, d, ok = true) => u.update_replication_target_status(r, s, d, ok);
const reconcile = () => u.reconcile_replication_target_status();
const gauge = () => Object.values(g().hashMap).find(e => e.labels?.target_bucket === DST)?.value;
const copy_sem = { surround_count: async (_n, fn) => fn() };
const copy_client = { replication: { copy_objects: jest.fn() } };
const copy_keys = { key1: [{ Size: 1 }] };

const seed = (rid, dsts, o = {}) => {
    const rules = dsts.map((n, i) => ({ rule_id: `r${i}`, destination_bucket: `dst-id-${n}` }));
    mock_store.buckets = [
        b({ _id: 'src-id', name: SRC, replication_policy_id: rid, deleting: o.del_src && new Date() }),
        ...dsts.map(n => b({ _id: `dst-id-${n}`, name: o.del_dst === n ? `${n}-deleting-9` : n, deleting: o.del_dst === n && new Date() })),
    ];
    mock_get_all_replication_configs.mockResolvedValue([{ _id: rid, rules }]);
};

describe('NooBaa_replication_target_status', () => {
    beforeAll(() => { report = new NooBaaCoreReport(); mock_core.mockReturnValue(report); });
    beforeEach(() => {
        reset();
        mock_store.buckets = [];
        mock_store.deleted.clear();
        mock_store.get_by_id = id => mock_store.buckets.find(doc => String(doc._id) === String(id));
        mock_get_all_replication_configs.mockReset();
        mock_core.mockReturnValue(report);
    });

    it.each([
        [
            'clears leftover reachability metrics when replication_id is not in replication DB',
            () => mock_get_all_replication_configs.mockResolvedValue([{
                _id: R2,
                rules: [{ rule_id: 'r0', destination_bucket: 'dst-id-a' }],
            }]),
            [],
        ],
        [
            'removes all metrics when no source bucket references replication_id (source bucket removed)',
            () => {
                mock_get_all_replication_configs.mockResolvedValue([{ _id: R1, rules: [{ rule_id: 'r0', destination_bucket: 'dst-id-a' }] }]);
                mock_store.buckets = [b({ _id: 'dst-id-a', name: DST })];
            },
            [],
        ],
        [
            'keeps reachability metrics when deleting destination name strips to label already on the gauge',
            () => seed(R1, [DST], { del_dst: DST }),
            [DST],
        ],
    ])('reconcile at scan start: %s', async (_desc, setup, want) => {
        probe(R1, SRC, DST);
        setup();
        await reconcile();
        expect(tgts(R1)).toEqual(want);
    });

    it('reconcile clears reachability metrics for soft-deleted replication policies', async () => {
        probe(R1, SRC, DST);
        mock_get_all_replication_configs.mockResolvedValue([{
            _id: R1,
            rules: [{ rule_id: 'r0', destination_bucket: 'dst-id-a' }],
            deleted: new Date(),
        }]);
        await reconcile();
        expect(tgts(R1)).toEqual([]);
    });

    it('reconcile removes leftover reachability metrics when source/destination labels no longer match replication DB', async () => {
        probe(R1, SRC, DST);
        probe(R1, SRC, 'dst-b');
        probe(R1, SRC, 'stale');
        g().hashMap.bad = { labels: null, value: 0 };
        seed(R1, [DST, 'dst-b']);
        await reconcile();
        expect(tgts(R1).sort()).toEqual([DST, 'dst-b'].sort());
        expect(g().hashMap.bad).toBeDefined();
    });

    it('clear_replication_target_status_for_orphan_policy clears one policy only; missing replication_id is ignored', () => {
        u.update_replication_target_status(undefined, SRC, DST, true);
        expect(Object.keys(g().hashMap)).toHaveLength(0);
        probe(R1, SRC, DST);
        probe(R2, SRC, DST);
        u.clear_replication_target_status_for_orphan_policy(undefined);
        u.clear_replication_target_status_for_orphan_policy(R1);
        expect(tgts(R1)).toHaveLength(0);
        expect(tgts(R2)).toHaveLength(1);
    });

    it.each([
        ['sets gauge to 1 when replication scanner bucket diff succeeds (target reachable)', true, 1],
        ['sets gauge to 0 when replication scanner bucket diff fails (target unreachable)', false, 0],
    ])('%s', (_desc, ok, want) => {
        probe(R1, SRC, DST, ok);
        expect(gauge()).toBe(want);
    });

    describe('scan reachability after diff', () => {
        beforeEach(() => {
            mock_store.systems = [{ _id: 'sys', owner: { _id: 'owner' } }];
            copy_client.replication.copy_objects.mockReset();
        });

        it.each([
            [
                'sets replication_target_status to 1 after copy_objects when at least one object was replicated',
                { num_of_objects: 1, size_of_objects: 1 },
                1,
            ],
            [
                'sets replication_target_status to 0 after copy_objects when copy fails and num_of_objects moved is 0',
                { num_of_objects: 0, size_of_objects: 0 },
                0,
            ],
        ])('%s', async (_desc, res, want) => {
            copy_client.replication.copy_objects.mockResolvedValue(res);
            await u.copy_objects(copy_sem, copy_client, 'MIX', SRC, DST, copy_keys, R1);
            expect(gauge()).toBe(want);
        });

        it('does not update replication_target_status when copy_objects is called with an empty keys_diff_map', async () => {
            probe(R1, SRC, DST, false);
            await u.copy_objects(copy_sem, copy_client, 'MIX', SRC, DST, {}, R1);
            expect(copy_client.replication.copy_objects).not.toHaveBeenCalled();
            expect(gauge()).toBe(0);
        });

        it('keeps replication_target_status at 0 after failed copy and sets 1 only when scan has no keys to copy', async () => {
            copy_client.replication.copy_objects.mockResolvedValue({ num_of_objects: 0, size_of_objects: 0 });
            await u.copy_objects(copy_sem, copy_client, 'MIX', SRC, DST, copy_keys, R1);
            expect(gauge()).toBe(0);
            await u.copy_objects(copy_sem, copy_client, 'MIX', SRC, DST, {}, R1);
            expect(gauge()).toBe(0);
            probe(R1, SRC, DST, true);
            expect(gauge()).toBe(1);
        });
    });

    it.each([
        [
            'does not query replication DB when prometheus gauge is not initialized',
            () => mock_core.mockReturnValueOnce({ _metrics: null }),
        ],
        [
            'does not query replication DB when gauge has no series with replication_id labels',
            () => { g().hashMap.bad = { labels: null, value: 0 }; },
        ],
    ])('reconcile early exit: %s', async (_desc, prep) => {
        prep();
        await reconcile();
        expect(mock_get_all_replication_configs).not.toHaveBeenCalled();
    });

    it('NooBaaCoreReport set and clear do nothing when _metrics is null (prometheus disabled)', () => {
        const m = report._metrics;
        report._metrics = null;
        report.set_replication_target_status(R1, SRC, DST, 1);
        report.clear_replication_target_status_by_replication_id(R1);
        report._metrics = m;
        expect(Object.keys(g().hashMap)).toHaveLength(0);
    });

    it.each([
        [
            'returns bucket name via get_by_id_include_deleted DB has no bucket row, but soft-deleted row exists',
            () => mock_store.deleted.set('d', b({ _id: 'd', name: DST, deleting: new Date() })),
            'd',
            DST,
        ],
        [
            'falls back to bucket id when DB has no bucket row (including soft-deleted row)',
            () => undefined,
            'gone',
            'gone',
        ],
        [
            'falls back to bucket id when system_store lookup throws error',
            () => { mock_store.get_by_id = () => { throw new Error('db'); }; },
            'err',
            'err',
        ],
        [
            'strips -deleting-<timestamp> suffix from bucket name while bucket is deleting',
            () => { mock_store.buckets = [b({ _id: 'd', name: `${DST}-deleting-9`, deleting: new Date() })]; },
            'd',
            DST,
        ],
    ])('resolve_destination_bucket_name: %s', async (_desc, prep, id, want) => {
        prep();
        await expect(u.resolve_destination_bucket_name(id)).resolves.toBe(want);
    });
});
