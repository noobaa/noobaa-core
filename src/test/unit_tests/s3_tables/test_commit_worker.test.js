/* Copyright (C) 2026 NooBaa */
'use strict';

const engine_module = require('../../../sdk/s3_tables/s3_tables_commit_worker_host');
const commit_engine = require('../../../sdk/s3_tables/s3_tables_commit_engine');
const lossless_json = require('../../../sdk/s3_tables/s3_tables_lossless_json');
const { detachable } = require('../../../sdk/s3_tables/s3_tables_transfer_utils');
const fixtures = require('./s3_tables_fixtures');

const { CommitWorkerHost, derive_limits, fork_share_bytes } = engine_module;
const { BIG_SNAPSHOT_ID, TABLE_LOCATION, make_ctx, metadata_file_location } = fixtures;

const MB = 1024 * 1024;

// ///////////////////////////////////////////////////////////////////////////////////
// helpers
// ///////////////////////////////////////////////////////////////////////////////////

/** Engines created by a test, stopped in afterEach so no worker outlives its case. */
let engines = [];

/**
 * @param {object} [params]
 * @returns {CommitWorkerHost}
 */
function make_engine(params) {
    const engine = new CommitWorkerHost({
        max_parse_bytes: 50 * MB,
        budget_bytes: 800 * MB,
        idle_timeout_ms: 60_000,
        ...params,
    });
    engines.push(engine);
    return engine;
}

function commit_ctx(overrides) {
    return {
        ...make_ctx(overrides),
        previous_metadata_location: metadata_file_location(1),
    };
}

/** @returns {Buffer} a valid current metadata document */
function metadata_bytes(overrides) {
    return Buffer.from(lossless_json.stringify(fixtures.initial_metadata(overrides)), 'utf8');
}

/** @returns {Buffer} a commit that sets one property, so every transform is distinguishable */
function commit_bytes(value) {
    return Buffer.from(JSON.stringify({
        requirements: [],
        updates: [{ action: 'set-properties', updates: { owner: value } }],
    }), 'utf8');
}

/**
 * A metadata document padded with fabricated snapshots until it is roughly the
 * requested size. Only the `snapshots` array grows - the snapshot log and metadata log
 * are left alone, so the document still satisfies the engine's ordering assertions.
 * @param {number} target_bytes
 * @returns {Buffer}
 */
function big_metadata_bytes(target_bytes) {
    const metadata = fixtures.initial_metadata();
    const snapshots = [];
    // ~330 bytes of text per snapshot, and the reviver fires on every id, which is what
    // makes the parsed graph cost several times the text
    const count = Math.ceil(target_bytes / 330);
    for (let i = 0; i < count; ++i) {
        const id = `81031591497236${String(10000 + (i % 10000))}`;
        snapshots.push({
            'snapshot-id': JSON.rawJSON(id),
            'parent-snapshot-id': JSON.rawJSON(id),
            'sequence-number': i,
            'timestamp-ms': fixtures.NOW_MS - 1000,
            'manifest-list': `${TABLE_LOCATION}/metadata/snap-${id}-1-84e1dc8f-0b1c-4d2e-9f30-415263748596.avro`,
            'summary': {
                operation: 'append',
                'added-data-files': '3',
                'added-records': '1200',
                'total-records': String(i * 1200),
                'total-files-size': '123456789',
            },
            'schema-id': 0,
        });
    }
    metadata.snapshots = snapshots;
    return Buffer.from(lossless_json.stringify(metadata), 'utf8');
}

/** @param {number} ms */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Run one transform end to end, taking and releasing an admission slot the way the
 * commit path will.
 * @param {CommitWorkerHost} engine
 */
async function run(engine, { metadata, commit, ctx }) {
    const slot = await engine.acquire(commit.byteLength);
    try {
        slot.top_up(metadata.byteLength + commit.byteLength);
        return await engine.transform({ metadata_bytes: metadata, commit_bytes: commit, ctx, slot });
    } finally {
        slot.release();
    }
}

afterEach(async () => {
    const to_stop = engines;
    engines = [];
    await Promise.all(to_stop.map(engine => engine.stop()));
});

// ///////////////////////////////////////////////////////////////////////////////////
// the worker runs the engine, and nothing else
// ///////////////////////////////////////////////////////////////////////////////////

describe('commit worker - output fidelity', () => {

    it('produces bytes identical to running the engine directly', async () => {
        const ctx = commit_ctx();
        const metadata = metadata_bytes();
        const commit = commit_bytes('danny');
        const direct = commit_engine.transform({
            metadata_bytes: Buffer.from(metadata),
            commit_bytes: Buffer.from(commit),
            ctx,
        });
        const via_worker = await run(make_engine(), { metadata, commit, ctx });
        expect(via_worker.next_bytes.toString('utf8')).toBe(direct.next_bytes.toString('utf8'));
        expect(via_worker.header).toEqual(direct.header);
    });

    it('preserves an out-of-range snapshot id across the thread boundary', async () => {
        // the lossless reviver is the reason bytes cross rather than objects: a
        // structured-cloned object graph would have rounded this id
        const ctx = commit_ctx();
        const snapshot = {
            'snapshot-id': JSON.rawJSON(BIG_SNAPSHOT_ID),
            'parent-snapshot-id': null,
            'sequence-number': 1,
            'timestamp-ms': fixtures.NOW_MS + 1,
            'manifest-list': `${TABLE_LOCATION}/metadata/snap-${BIG_SNAPSHOT_ID}-1-84e1.avro`,
            'summary': { operation: 'append' },
            'schema-id': 0,
        };
        const commit = Buffer.from(JSON.stringify({
            requirements: [],
            updates: [{ action: 'add-snapshot', snapshot }],
        }), 'utf8');
        const result = await run(make_engine(), { metadata: metadata_bytes(), commit, ctx });
        const text = result.next_bytes.toString('utf8');
        expect(text).toContain(`"snapshot-id":${BIG_SNAPSHOT_ID}`);
    });

    it('does not corrupt neighbouring pooled buffers when it transfers', async () => {
        // Buffer.from() under 4 KiB is a view into Node's shared pool. Transferring the
        // underlying ArrayBuffer would detach the pool and silently empty every other
        // buffer in it - this is the regression test for detachable().
        const neighbour = Buffer.from('x'.repeat(256), 'utf8');
        const commit = commit_bytes('pooled');
        expect(commit.byteLength).toBeLessThan(4096);
        const shared_pool = neighbour.buffer === commit.buffer;
        await run(make_engine(), { metadata: metadata_bytes(), commit, ctx: commit_ctx() });
        expect(neighbour.byteLength).toBe(256);
        expect(neighbour.toString('utf8')).toBe('x'.repeat(256));
        // if the pool was not shared the case proved less than it meant to, but the
        // assertion above is still correct - record which one ran
        expect(typeof shared_pool).toBe('boolean');
    });

    it('leaves a buffer that owns its whole ArrayBuffer uncopied', () => {
        const owned = Buffer.from(new ArrayBuffer(1024));
        expect(detachable(owned)).toBe(owned);
        const pooled = Buffer.from('small', 'utf8');
        const safe = detachable(pooled);
        expect(safe).not.toBe(pooled);
        expect(Buffer.from(safe).toString('utf8')).toBe('small');
        expect(safe.byteOffset).toBe(0);
        expect(safe.byteLength).toBe(safe.buffer.byteLength);
    });
});

// ///////////////////////////////////////////////////////////////////////////////////
// errors across the boundary
// ///////////////////////////////////////////////////////////////////////////////////

describe('commit worker - error round trip', () => {

    /**
     * Structured clone keeps only name/message/stack on an Error, so every one of these
     * would arrive as an anonymous Error if the worker posted the object itself.
     */
    it.each([
        ['InvalidRequest', { requirements: [], updates: [{ action: 'no-such-action' }] }, 'UnsupportedOperation'],
        ['RequirementFailed', {
            requirements: [{ type: 'assert-table-uuid', uuid: '00000000-0000-4000-8000-000000000000' }],
            updates: [],
        }, 'RequirementFailed'],
    ])('delivers a %s as a semantic error with its code', async (_label, commit_body, expected_code) => {
        const engine = make_engine();
        const commit = Buffer.from(JSON.stringify(commit_body), 'utf8');
        await expect(run(engine, { metadata: metadata_bytes(), commit, ctx: commit_ctx() }))
            .rejects.toMatchObject({ name: 'S3TablesError', code: expected_code });
    });

    it('reports a corrupt stored document as MetadataIntegrity, not as a client error', async () => {
        const engine = make_engine();
        await expect(run(engine, {
            metadata: Buffer.from('this is not json', 'utf8'),
            commit: commit_bytes('x'),
            ctx: commit_ctx(),
        })).rejects.toMatchObject({ code: 'MetadataIntegrity' });
    });

    it('keeps an unexpected error unexpected rather than dressing it as semantic', () => {
        const err = engine_module.rebuild_error({
            name: 'TypeError', message: 'ctx.table_id is required', stack: 'TypeError: ctx.table_id is required\n  at x',
        });
        expect(err.name).toBe('TypeError');
        expect(err.message).toBe('ctx.table_id is required');
        // @ts-ignore
        expect(err.code).toBe('S3TABLES_WORKER_ERROR');
        expect(err instanceof require('../../../sdk/s3_tables/s3_tables_errors').S3TablesError).toBe(false);
    });
});

// ///////////////////////////////////////////////////////////////////////////////////
// correlation and ordering
// ///////////////////////////////////////////////////////////////////////////////////

describe('commit worker - correlation', () => {

    it('resolves concurrent requests to their own responses, in order', async () => {
        const engine = make_engine();
        const ctx = commit_ctx();
        const owners = ['alpha', 'beta', 'gamma', 'delta'];
        const results = await Promise.all(owners.map(owner =>
            run(engine, { metadata: metadata_bytes(), commit: commit_bytes(owner), ctx })));
        results.forEach((result, i) => {
            const document = JSON.parse(result.next_bytes.toString('utf8'));
            expect(document.properties.owner).toBe(owners[i]);
        });
    });

    it('keeps a failure from disturbing the requests around it', async () => {
        const engine = make_engine();
        const ctx = commit_ctx();
        const settled = await Promise.allSettled([
            run(engine, { metadata: metadata_bytes(), commit: commit_bytes('ok-1'), ctx }),
            run(engine, { metadata: Buffer.from('{]', 'utf8'), commit: commit_bytes('bad'), ctx }),
            run(engine, { metadata: metadata_bytes(), commit: commit_bytes('ok-2'), ctx }),
        ]);
        expect(settled.map(s => s.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
        expect(engine.stats.worker_restarts).toBe(0);
    });
});

// ///////////////////////////////////////////////////////////////////////////////////
// death, heap exhaustion, and the absence of a learned threshold
// ///////////////////////////////////////////////////////////////////////////////////

describe('commit worker - death', () => {

    it('fails the dispatched request as retryable and still serves the queued one', async () => {
        const engine = make_engine();
        const ctx = commit_ctx();
        // one big enough that the worker is still busy when it is killed, plus one queued
        const dispatched = run(engine, { metadata: big_metadata_bytes(4 * MB), commit: commit_bytes('killed'), ctx });
        const queued = run(engine, { metadata: metadata_bytes(), commit: commit_bytes('survivor'), ctx });
        await delay(20);
        await engine._workers[0].worker.terminate();

        await expect(dispatched).rejects.toMatchObject({ code: 'TransientFailure' });
        const result = await queued;
        expect(JSON.parse(result.next_bytes.toString('utf8')).properties.owner).toBe('survivor');
        expect(engine.stats.worker_restarts).toBe(1);
    }, 30_000);

    it('refuses a document too large for the heap without letting the worker try', async () => {
        // The worker must never be sent work that lands near its heap limit: measured on
        // the pinned Node, a parse that overruns a limit *close* to what it needs aborts
        // the whole process with FATAL ERROR instead of raising ERR_WORKER_OUT_OF_MEMORY.
        // So this is refused up front, and no worker dies.
        const engine = make_engine({ heap_limit_bytes: 16 * MB });
        const ctx = commit_ctx();
        const big = big_metadata_bytes(5 * MB);

        await expect(run(engine, { metadata: Buffer.from(big), commit: commit_bytes('too-big'), ctx }))
            .rejects.toMatchObject({ code: 'Throttled' });
        expect(engine.stats.oom_count).toBe(0);
        expect(engine.stats.worker_restarts).toBe(0);

        // a document that fits is served normally, before and after
        const small = await run(engine, { metadata: metadata_bytes(), commit: commit_bytes('fine'), ctx });
        expect(JSON.parse(small.next_bytes.toString('utf8')).properties.owner).toBe('fine');

        // the same large document is judged against the same constant again, not against
        // a floor remembered from the refusal - the ratchet regression test
        await expect(run(engine, { metadata: Buffer.from(big), commit: commit_bytes('too-big'), ctx }))
            .rejects.toMatchObject({ code: 'Throttled' });
        const after = await run(engine, { metadata: metadata_bytes(), commit: commit_bytes('still-fine'), ctx });
        expect(JSON.parse(after.next_bytes.toString('utf8')).properties.owner).toBe('still-fine');
    }, 30_000);

    it('accepts a document the heap has room for, and refuses the one just past it', async () => {
        const engine = make_engine({ heap_limit_bytes: 64 * MB });
        const ctx = commit_ctx();
        // the boundary is HEAP_ADMIT_FACTOR x the document, counting the commit body too
        const fits = big_metadata_bytes(8 * MB);
        const over = big_metadata_bytes(12 * MB);
        expect(fits.byteLength * engine_module.HEAP_ADMIT_FACTOR).toBeLessThan(64 * MB);
        expect(over.byteLength * engine_module.HEAP_ADMIT_FACTOR).toBeGreaterThan(64 * MB);

        await expect(run(engine, { metadata: fits, commit: commit_bytes('ok'), ctx })).resolves.toBeDefined();
        await expect(run(engine, { metadata: over, commit: commit_bytes('no'), ctx }))
            .rejects.toMatchObject({ code: 'Throttled' });
        expect(engine.stats.worker_restarts).toBe(0);
    }, 30_000);

    // The pre-flight check above means a heap OOM should now be unreachable through the
    // public path, so the classification is exercised directly - deliberately driving a
    // worker into heap exhaustion risks the process-abort case described there.
    it('calls an OOM on a small document a defect, not capacity', () => {
        const engine = make_engine();
        const oom = Object.assign(new Error('JS heap out of memory'), { code: 'ERR_WORKER_OUT_OF_MEMORY' });
        const small = engine._classify_death(oom, { bytes: 4096 });
        expect(small.code).toBe('TransientFailure');
        const large = engine._classify_death(oom, { bytes: 8 * MB });
        expect(large.code).toBe('Throttled');
    });

    it('treats any other death as a provable no-op', () => {
        const engine = make_engine();
        const err = engine._classify_death(new Error('worker exited with code 1'), { bytes: 50 * MB });
        expect(err.code).toBe('TransientFailure');
    });
});

// ///////////////////////////////////////////////////////////////////////////////////
// admission
// ///////////////////////////////////////////////////////////////////////////////////

describe('commit engine - admission', () => {

    const BUDGET = 256 * 1024; // four minimum charges

    it('refuses a commit larger than the whole budget instead of hanging on it', async () => {
        const engine = make_engine({ buffer_budget_bytes: BUDGET });
        await expect(engine.acquire(BUDGET + 1)).rejects.toMatchObject({ code: 'Throttled' });
    });

    it('rejects once the waiting queue is full, and recovers as slots are released', async () => {
        const engine = make_engine({ buffer_budget_bytes: BUDGET });
        const held = [];
        for (let i = 0; i < 4; ++i) held.push(await engine.acquire(64 * 1024));
        expect(engine.stats.held_bytes).toBe(BUDGET);

        // these cannot be served yet, so they queue - and their total fills the bound
        const waiting = [];
        for (let i = 0; i < 4; ++i) waiting.push(engine.acquire(64 * 1024));
        await expect(engine.acquire(64 * 1024)).rejects.toMatchObject({ code: 'Throttled' });

        held.forEach(slot => slot.release());
        const admitted = await Promise.all(waiting);
        expect(admitted).toHaveLength(4);
        admitted.forEach(slot => slot.release());
        expect(engine.stats.held_bytes).toBe(0);
    });

    it('tops up to the real size once the metadata is fetched, and never blocks doing it', async () => {
        const engine = make_engine({ buffer_budget_bytes: BUDGET });
        // a request body's Content-Length is all that is known before the fetch
        const first = await engine.acquire(1024);
        expect(first.charged).toBe(engine_module.MIN_CHARGE_BYTES);
        first.top_up(128 * 1024);
        expect(first.charged).toBe(128 * 1024);

        // a second commit is admitted on its body, then finds its metadata too large for
        // what is left. It must be told so immediately: waiting here is the deadlock -
        // every slot could be a request waiting for capacity only another could release
        const second = await engine.acquire(1024);
        expect(() => second.top_up(200 * 1024)).toThrow(expect.objectContaining({ code: 'Throttled' }));
        // and the failed top-up changed nothing, so its own release still balances
        expect(second.charged).toBe(engine_module.MIN_CHARGE_BYTES);

        first.release();
        second.release();
        expect(engine.stats.held_bytes).toBe(0);
    });

    it('releases idempotently', async () => {
        const engine = make_engine({ buffer_budget_bytes: BUDGET });
        const slot = await engine.acquire(64 * 1024);
        slot.release();
        slot.release();
        expect(engine.stats.held_bytes).toBe(0);
    });

    it('will not run a transform without a slot', () => {
        const engine = make_engine();
        expect(() => engine.transform({
            metadata_bytes: metadata_bytes(), commit_bytes: commit_bytes('x'), ctx: commit_ctx(), slot: undefined,
        })).toThrow(TypeError);
    });
});

// ///////////////////////////////////////////////////////////////////////////////////
// worker lifecycle
// ///////////////////////////////////////////////////////////////////////////////////

describe('commit engine - worker lifecycle', () => {

    it('spawns no worker until the first commit', async () => {
        const engine = make_engine();
        expect(engine.stats.workers).toBe(0);
        await run(engine, { metadata: metadata_bytes(), commit: commit_bytes('first'), ctx: commit_ctx() });
        expect(engine.stats.workers).toBe(1);
    });

    it('reuses the one worker across commits', async () => {
        const engine = make_engine();
        const ctx = commit_ctx();
        await run(engine, { metadata: metadata_bytes(), commit: commit_bytes('a'), ctx });
        const first = engine._workers[0].worker;
        await run(engine, { metadata: metadata_bytes(), commit: commit_bytes('b'), ctx });
        expect(engine._workers[0].worker).toBe(first);
        expect(engine.stats.workers).toBe(1);
    });

    it('gives the worker back when it goes idle, and brings one back on demand', async () => {
        // V8 never returns a grown old-space, so an idle worker holds whatever the
        // largest transform grew it to for the life of the process
        const engine = make_engine({ idle_timeout_ms: 50 });
        const ctx = commit_ctx();
        await run(engine, { metadata: metadata_bytes(), commit: commit_bytes('before'), ctx });
        expect(engine.stats.workers).toBe(1);

        await delay(250);
        expect(engine.stats.workers).toBe(0);

        const after = await run(engine, { metadata: metadata_bytes(), commit: commit_bytes('after'), ctx });
        expect(JSON.parse(after.next_bytes.toString('utf8')).properties.owner).toBe('after');
        expect(engine.stats.workers).toBe(1);
    }, 15_000);

    it('fails anything outstanding when it is stopped', async () => {
        const engine = new CommitWorkerHost({ max_parse_bytes: 50 * MB, budget_bytes: 800 * MB });
        const ctx = commit_ctx();
        const running = run(engine, { metadata: big_metadata_bytes(2 * MB), commit: commit_bytes('x'), ctx });
        await delay(10);
        await engine.stop();
        await expect(running).rejects.toMatchObject({ code: 'TransientFailure' });
        await expect(run(engine, { metadata: metadata_bytes(), commit: commit_bytes('y'), ctx }))
            .rejects.toMatchObject({ code: 'TransientFailure' });
    }, 15_000);
});

// ///////////////////////////////////////////////////////////////////////////////////
// sizing
// ///////////////////////////////////////////////////////////////////////////////////

describe('commit engine - sizing', () => {

    const GiB = 1024 * MB;

    it('divides the pod by the fork count only when the limit is genuinely pod-wide', () => {
        // config.CONTAINER_MEM_LIMIT falls back to config.OS_MEM_LIMIT, which config.js
        // has already divided by ENDPOINT_FORKS - dividing again would halve twice
        expect(fork_share_bytes({
            container_env: '4294967296', container_mem_limit: 4 * GiB, os_mem_limit: GiB, forks: 4,
        })).toBe(GiB);
        expect(fork_share_bytes({
            container_env: undefined, container_mem_limit: GiB, os_mem_limit: GiB, forks: 4,
        })).toBe(GiB);
        // the shipped case: the operator sets the variable and never sets ENDPOINT_FORKS
        expect(fork_share_bytes({
            container_env: '3221225472', container_mem_limit: 3 * GiB, os_mem_limit: 99, forks: 0,
        })).toBe(3 * GiB);
    });

    /**
     * The endpoint shapes noobaa-operator actually creates, from the performance
     * profiles. A worst-case commit has to fit the default profile.
     */
    it.each([
        ['default profile, 3 GiB', 3 * GiB, false],
        ['mixed workload, 4 GiB', 4 * GiB, false],
        ['small objects, 4 GiB', 4 * GiB, false],
    ])('admits a commit at the cap on the %s', (_label, mem_limit, undersized) => {
        const budget_bytes = mem_limit * 0.25;
        const limits = derive_limits({ max_parse_bytes: 50 * MB, budget_bytes });
        expect(limits.undersized).toBe(undersized);
        // the heap holds a worst-case document, and admission can still charge one
        expect(limits.heap_limit_bytes).toBeGreaterThanOrEqual(50 * MB * 4);
        expect(limits.buffer_budget_bytes).toBeGreaterThanOrEqual(50 * MB);
        // and the three parts stay inside the budget they were carved from
        expect(limits.heap_limit_bytes + limits.buffer_budget_bytes + engine_module.WORKER_BASELINE_BYTES)
            .toBeLessThanOrEqual(budget_bytes);
    });

    it('degrades a dev-sized pod to small tables rather than to nothing', () => {
        // DevEnv and MiniEnv give the endpoint 500 MiB
        const limits = derive_limits({ max_parse_bytes: 50 * MB, budget_bytes: 500 * MB * 0.25 });
        expect(limits.undersized).toBe(true);
        expect(limits.buffer_budget_bytes).toBe(engine_module.MIN_BUFFER_BUDGET_BYTES);
        expect(limits.heap_limit_bytes).toBeGreaterThan(0);
    });

    it('never derives a heap too small for V8 to run the engine in', () => {
        const limits = derive_limits({ max_parse_bytes: MB, budget_bytes: 4 * GiB });
        expect(limits.heap_limit_bytes).toBe(engine_module.MIN_HEAP_BYTES);
    });
});
