/* Copyright (C) 2016 NooBaa */
'use strict';

// bg_workers gauge: reconcile fixes stale series after policy delete, src removal,
// rule change, id-vs-name labels, and -deleting-* names (web clear does not apply here).

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

const mock_get_replication_by_id = jest.fn();
jest.mock('../../../server/system_services/replication_store', () => ({
    instance: () => ({ get_replication_by_id: mock_get_replication_by_id }),
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

const seed = (rid, dsts, o = {}) => {
    const rules = dsts.map((n, i) => ({ rule_id: `r${i}`, destination_bucket: `dst-id-${n}` }));
    mock_store.buckets = [
        b({ _id: 'src-id', name: SRC, replication_policy_id: rid, deleting: o.del_src && new Date() }),
        ...dsts.map(n => b({ _id: `dst-id-${n}`, name: o.del_dst === n ? `${n}-deleting-9` : n, deleting: o.del_dst === n && new Date() })),
    ];
    mock_get_replication_by_id.mockImplementation(id => (String(id) === String(rid) ? Promise.resolve(rules) : null));
};

describe('NooBaa_replication_target_status', () => {
    beforeAll(() => { report = new NooBaaCoreReport(); mock_core.mockReturnValue(report); });
    beforeEach(() => {
        reset();
        mock_store.buckets = [];
        mock_store.deleted.clear();
        mock_store.get_by_id = id => mock_store.buckets.find(doc => String(doc._id) === String(id));
        mock_get_replication_by_id.mockReset();
        mock_core.mockReturnValue(report);
    });

    it.each([
        [
            'removes all stale metrics when replication policy was deleted from DB (mark_deleted)',
            () => mock_get_replication_by_id.mockResolvedValue(null),
            [],
        ],
        [
            'removes all stale metrics when no bucket has replication_policy_id (source bucket removed)',
            () => {
                mock_get_replication_by_id.mockResolvedValue([{ rule_id: 'r0', destination_bucket: 'dst-id-a' }]);
                mock_store.buckets = [b({ _id: 'dst-id-a', name: DST })];
            },
            [],
        ],
        [
            'keeps metrics when target is deleting if stripped name matches existing source_bucket/target_bucket labels',
            () => seed(R1, [DST], { del_dst: DST }),
            [DST],
        ],
    ])('reconcile at scan start: %s', async (_desc, setup, want) => {
        probe(R1, SRC, DST);
        setup();
        await reconcile();
        expect(tgts(R1)).toEqual(want);
    });

    it('reconcile prunes targets removed from policy and drops series where target_bucket is destination object id', async () => {
        probe(R1, SRC, DST);
        probe(R1, SRC, 'dst-b');
        probe(R1, SRC, 'stale');
        probe(R1, SRC, 'dst-id-a');
        g().hashMap.bad = { labels: null, value: 0 };
        seed(R1, [DST, 'dst-b']);
        await reconcile();
        expect(tgts(R1).sort()).toEqual([DST, 'dst-b'].sort());
        expect(g().hashMap.bad).toBeDefined();
    });

    it('clear_replication_target_status_for_orphan_policy clears one policy only; null replication_id is ignored', () => {
        u.update_replication_target_status(null, SRC, DST, true);
        expect(Object.keys(g().hashMap)).toHaveLength(0);
        probe(R1, SRC, DST);
        probe(R2, SRC, DST);
        u.clear_replication_target_status_for_orphan_policy(null);
        u.clear_replication_target_status_for_orphan_policy(R1);
        expect(tgts(R1)).toHaveLength(0);
        expect(tgts(R2)).toHaveLength(1);
    });

    it.each([
        ['sets gauge to 1 when replication scanner bucket diff succeeds (target reachable)', true, 1],
        ['sets gauge to 0 when replication scanner bucket diff fails (target unreachable)', false, 0],
    ])('%s', (_desc, ok, want) => {
        probe(R1, SRC, DST, ok);
        expect(Object.values(g().hashMap).find(e => e.labels?.target_bucket === DST)?.value).toBe(want);
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
        expect(mock_get_replication_by_id).not.toHaveBeenCalled();
    });

    it('NooBaaCoreReport set_replication_target_status and clear do nothing when _metrics is null', () => {
        const m = report._metrics;
        report._metrics = null;
        report.set_replication_target_status(R1, SRC, DST, 1);
        report.clear_replication_target_status_by_replication_id(R1);
        report._metrics = m;
        expect(Object.keys(g().hashMap)).toHaveLength(0);
    });

    it.each([
        [
            'returns bucket name from soft-deleted row via get_by_id_include_deleted',
            () => mock_store.deleted.set('d', b({ _id: 'd', name: DST, deleting: new Date() })),
            'd',
            DST,
        ],
        [
            'falls back to bucket id when live and deleted rows are missing',
            () => undefined,
            'gone',
            'gone',
        ],
        [
            'falls back to bucket id when system_store lookup throws',
            () => { mock_store.get_by_id = () => { throw new Error('db'); }; },
            'err',
            'err',
        ],
        [
            'returns empty string when bucket name unwraps to empty',
            () => { mock_store.buckets = [{ _id: 'd', name: new SensitiveString('') }]; },
            'd',
            '',
        ],
        [
            'returns empty string when deleting bucket has empty name before suffix strip',
            () => { mock_store.buckets = [b({ _id: 'd', name: '', deleting: new Date() })]; },
            'd',
            '',
        ],
        [
            'strips -deleting-<timestamp> suffix and returns base bucket name',
            () => { mock_store.buckets = [b({ _id: 'd', name: '-deleting-1', deleting: new Date() })]; },
            'd',
            '',
        ],
    ])('resolve_destination_bucket_name: %s', async (_desc, prep, id, want) => {
        prep();
        await expect(u.resolve_destination_bucket_name(id)).resolves.toBe(want);
    });
});
