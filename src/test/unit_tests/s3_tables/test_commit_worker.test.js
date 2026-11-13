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
 * Resolve once the engine has posted a request into its worker. A transform is fast
 * enough now that "wait a little, then act" races it; this does not.
 * @param {CommitWorkerHost} engine
 */
async function until_dispatched(engine) {
    while (!(engine._workers[0] && engine._workers[0].current)) {
        // eslint-disable-next-line no-await-in-loop
        await delay(1);
    }
}

/**
 * Run one transform end to end the way the commit path will - inside the reservation,
 * whose size the caller knows before it reads anything.
 * @param {CommitWorkerHost} engine
 */
async function run(engine, { metadata, commit, ctx }) {
    // the shape the commit path will use: the size is known from read_object_md before
    // the document is fetched, so the reservation precedes the allocation
    return engine.admit(metadata.byteLength + commit.byteLength, () =>
        engine.transform({ metadata_bytes: metadata, commit_bytes: commit, ctx }));
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
        await until_dispatched(engine);
        await engine._workers[0].worker.terminate();

        await expect(dispatched).rejects.toMatchObject({ code: 'TransientFailure' });
        const result = await queued;
        expect(JSON.parse(result.next_bytes.toString('utf8')).properties.owner).toBe('survivor');
        expect(engine.stats.worker_restarts).toBe(1);
    }, 30_000);

    it('serves a document larger than its whole heap limit', async () => {
        // the heap does not depend on the document (§8.1): the snapshots are never
        // parsed, so there is no size at which a document stops fitting
        const engine = make_engine({ heap_limit_bytes: 24 * MB });
        const ctx = commit_ctx();
        const big = big_metadata_bytes(32 * MB);
        expect(big.byteLength).toBeGreaterThan(engine.heap_limit_bytes);

        const result = await run(engine, { metadata: big, commit: commit_bytes('fits'), ctx });
        expect(result.next_bytes.byteLength).toBeGreaterThan(32 * MB);
        expect(engine.stats.oom_count).toBe(0);
        expect(engine.stats.worker_restarts).toBe(0);
    }, 60_000);

    it('commits to a document dense in small values without parsing them', async () => {
        // 6 MB of empty objects inside one statistics entry needs about 450 MB of heap to
        // parse, and a parse that overruns the heap limit aborts the whole process. The
        // entry is copied, never parsed, so a 32 MB heap is plenty.
        const engine = make_engine({ heap_limit_bytes: 32 * MB });
        const ctx = commit_ctx();
        const empties = `${'{},'.repeat(2 * MB)}{}`;
        const base = metadata_bytes().toString('utf8');
        const hostile = Buffer.from(`${base.slice(0, -1)},"statistics":[{"snapshot-id":1,"blob-metadata":[${empties}]}]}`, 'utf8');

        const result = await run(engine, { metadata: Buffer.from(hostile), commit: commit_bytes('ok'), ctx });
        expect(result.next_bytes.includes(`"blob-metadata":[${empties.slice(0, 64)}`)).toBe(true);
        expect(engine.stats.oom_count).toBe(0);
        expect(engine.stats.worker_restarts).toBe(0);
    }, 60_000);

    it('enforces its own parse caps, whatever the caller put in the context', async () => {
        // the caps are what this process's heap was sized for, so they cannot be the
        // caller's to raise
        const engine = make_engine({ max_commit_bytes: 64 * 1024, max_parsed_bytes: 64 * 1024 });
        const ctx = commit_ctx({ max_commit_bytes: 50 * MB, max_parsed_bytes: 50 * MB });
        const large_commit = Buffer.from(JSON.stringify({
            requirements: [],
            updates: [{ action: 'set-properties', updates: { owner: 'x'.repeat(100 * 1024) } }],
        }), 'utf8');
        await expect(run(engine, { metadata: metadata_bytes(), commit: large_commit, ctx }))
            .rejects.toMatchObject({ code: 'InvalidRequest' });
        const fine = await run(engine, { metadata: metadata_bytes(), commit: commit_bytes('fine'), ctx });
        expect(JSON.parse(fine.next_bytes.toString('utf8')).properties.owner).toBe('fine');
    }, 30_000);

    // The parse caps mean a heap OOM should be unreachable through the public path, so
    // the classification is exercised directly.
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
    const UNIT = 32 * 1024; // charged twice over - both inputs and the output - so one minimum charge

    /** Hold a reservation until the returned function is called. */
    function hold(engine, bytes) {
        let release;
        const held = new Promise(resolve => { release = resolve; });
        const admitted = engine.admit(bytes, () => held);
        return { release, admitted };
    }

    it('refuses a commit larger than the whole budget instead of queueing it', async () => {
        // the semaphore is fair, so a request no release can ever satisfy would sit at
        // the head of the queue blocking every legitimate waiter until it timed out
        const engine = make_engine({ buffer_budget_bytes: BUDGET });
        // the charge is twice the inputs, so half the budget is the largest commit
        await expect(engine.admit((BUDGET / 2) + 1, async () => 'never')).rejects.toMatchObject({ code: 'Throttled' });
        await expect(engine.admit(BUDGET / 2, async () => 'fits')).resolves.toBe('fits');
    });

    it('charges the real size rather than whatever shape the caller passed', async () => {
        // Semaphore's to_sem_count() turns a non-number into 1, and a Content-Length
        // arrives from HTTP as a string - charging 1 byte would defeat the budget
        const engine = make_engine({ buffer_budget_bytes: BUDGET });
        for (const [input, expected] of [['65536', 131072], [50000, 100000], [1024, 64 * 1024], [0, 64 * 1024]]) {
            // eslint-disable-next-line no-await-in-loop
            await engine.admit(input, async () => {
                expect(engine.stats.held_bytes).toBe(expected);
            });
        }
        expect(engine.stats.held_bytes).toBe(0);
    });

    it('rejects a size that is not a number instead of charging it a default', async () => {
        // a commit path that lost object_info.size must fail loudly: charged the minimum,
        // every commit would be admitted and the budget would bound nothing
        const engine = make_engine({ buffer_budget_bytes: BUDGET });
        const fn = jest.fn(async () => 'never');
        for (const input of [undefined, null, NaN, '', 'abc', -1, Infinity, {}]) {
            // eslint-disable-next-line no-await-in-loop
            await expect(engine.admit(input, fn)).rejects.toThrow(TypeError);
        }
        expect(fn).not.toHaveBeenCalled();
        expect(engine.stats.held_bytes).toBe(0);
    });

    it('admits by buffer bytes alone - the worker heap is not part of the decision', async () => {
        // a document far larger than the heap limit is admitted: nothing estimates what
        // it would cost to parse, because it is not parsed (§8.1)
        const engine = make_engine({ heap_limit_bytes: 16 * MB });
        const fetch_and_transform = jest.fn(async () => 'admitted');
        await expect(engine.admit(40 * MB, fetch_and_transform)).resolves.toBe('admitted');
        expect(fetch_and_transform).toHaveBeenCalledTimes(1);
        expect(engine.stats.held_bytes).toBe(0);
    });

    it('rejects from transform() rather than throwing, once it is stopped', async () => {
        const engine = make_engine();
        await engine.stop();
        const pending = engine.transform({
            metadata_bytes: metadata_bytes(), commit_bytes: commit_bytes('x'), ctx: commit_ctx(),
        });
        await expect(pending).rejects.toMatchObject({ code: 'TransientFailure' });
        expect(engine.stats.workers).toBe(0);
    });

    it('queues while the budget is full, and admits as reservations end', async () => {
        const engine = make_engine({ buffer_budget_bytes: BUDGET });
        const held = [];
        for (let i = 0; i < 4; ++i) held.push(hold(engine, UNIT));
        await delay(10);
        expect(engine.stats.held_bytes).toBe(BUDGET);

        // the second four must be waiting, not running: nothing more is held, and none
        // of their callbacks has started
        const started = [];
        const waiting = [];
        for (let i = 0; i < 4; ++i) {
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            const admitted = engine.admit(UNIT, () => {
                started.push(i);
                return gate;
            });
            waiting.push({ release, admitted });
        }
        await delay(10);
        expect(started).toEqual([]);
        expect(engine.stats.held_bytes).toBe(BUDGET);

        held.forEach(h => h.release());
        await Promise.all(held.map(h => h.admitted));
        // admitted in arrival order - the semaphore is fair
        expect(started).toEqual([0, 1, 2, 3]);
        expect(engine.stats.held_bytes).toBe(BUDGET);
        waiting.forEach(h => h.release());
        await Promise.all(waiting.map(h => h.admitted));
        expect(engine.stats.held_bytes).toBe(0);
    }, 15_000);

    it('throttles a wait that outlives the admission timeout - the bounded queue', async () => {
        // the semaphore's own timeout is the bound, as object_io uses it; the engine
        // only has to render it as the right semantic error
        const engine = make_engine({ buffer_budget_bytes: BUDGET, admission_timeout_ms: 60 });
        const held = [];
        for (let i = 0; i < 4; ++i) held.push(hold(engine, UNIT));
        await delay(10);
        await expect(engine.admit(UNIT, async () => 'never')).rejects.toMatchObject({ code: 'Throttled' });
        held.forEach(h => h.release());
        await Promise.all(held.map(h => h.admitted));
        expect(engine.stats.held_bytes).toBe(0);
    }, 15_000);

    it('releases the reservation however admit() exits', async () => {
        const engine = make_engine({ buffer_budget_bytes: BUDGET });

        const value = await engine.admit(UNIT, async () => {
            expect(engine.stats.held_bytes).toBe(2 * UNIT);
            return 'done';
        });
        expect(value).toBe('done');
        expect(engine.stats.held_bytes).toBe(0);

        // the reason for the shape: a throw inside must not leak the reservation
        await expect(engine.admit(UNIT, async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');
        expect(engine.stats.held_bytes).toBe(0);
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
        await until_dispatched(engine);
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

    const CAPS = { max_parsed_bytes: MB, max_commit_bytes: MB, max_raw_elements: 1000000 };

    /** What the worker heap must hold: the two caps at the worst factor measured. */
    function heap_needed(limits) {
        return engine_module.HEAP_BASE_BYTES +
            (engine_module.PARSE_HEAP_FACTOR * (limits.max_parsed_bytes + limits.max_commit_bytes));
    }

    /**
     * The endpoint shapes noobaa-operator actually creates, from the performance
     * profiles. A commit at the 50 MB cap has to fit the default profile.
     */
    it.each([
        ['default profile, 3 GiB', 3 * GiB],
        ['mixed workload, 4 GiB', 4 * GiB],
        ['small objects, 4 GiB', 4 * GiB],
    ])('keeps the configured caps and admits a commit at the cap on the %s', (_label, mem_limit) => {
        const budget_bytes = mem_limit * 0.25;
        const limits = derive_limits({ budget_bytes, ...CAPS });
        expect(limits.scaled).toBe(false);
        expect(limits).toMatchObject(CAPS);
        // the heap is a constant: the same on every profile, whatever the document
        expect(limits.heap_limit_bytes).toBe(256 * MB);
        expect(limits.heap_limit_bytes).toBe(heap_needed(limits));
        // admission can charge a document at the cap, its body and its output
        expect(limits.buffer_budget_bytes).toBeGreaterThanOrEqual(50 * MB * engine_module.COMMIT_CHARGE_FACTOR);
        // and the four parts stay inside the budget they were carved from
        expect(limits.heap_limit_bytes + limits.index_reserve_bytes + limits.buffer_budget_bytes +
            engine_module.WORKER_BASELINE_BYTES).toBeLessThanOrEqual(budget_bytes);
    });

    it('splits the default budget as the design states it', () => {
        const limits = derive_limits({ budget_bytes: 768 * MB, ...CAPS });
        expect(limits.heap_limit_bytes).toBe(256 * MB);
        expect(limits.index_reserve_bytes).toBe(48 * 1000000);
        expect(limits.buffer_budget_bytes).toBe((768 * MB) - (256 * MB) - (32 * MB) - (48 * 1000000));
    });

    it('degrades a dev-sized pod to smaller caps and smaller tables rather than to nothing', () => {
        // DevEnv and MiniEnv give the endpoint 500 MiB
        const budget_bytes = 500 * MB * 0.25;
        const limits = derive_limits({ budget_bytes, ...CAPS });
        expect(limits.scaled).toBe(true);
        // the caps shrink with the heap, so the heap still holds them at the worst factor
        expect(limits.max_parsed_bytes).toBeLessThan(MB);
        expect(limits.max_parsed_bytes).toBeGreaterThanOrEqual(engine_module.MIN_PARSE_CAP_BYTES);
        expect(limits.max_commit_bytes).toBe(limits.max_parsed_bytes);
        expect(limits.heap_limit_bytes).toBeGreaterThanOrEqual(heap_needed(limits));
        expect(limits.max_raw_elements).toBeLessThan(1000000);
        expect(limits.index_reserve_bytes)
            .toBeGreaterThanOrEqual(limits.max_raw_elements * engine_module.INDEX_BYTES_PER_ELEMENT);
        // tables of about 20 MB still commit
        expect(limits.buffer_budget_bytes).toBeGreaterThan(30 * MB);
        expect(limits.heap_limit_bytes + limits.index_reserve_bytes + limits.buffer_budget_bytes +
            engine_module.WORKER_BASELINE_BYTES).toBeLessThanOrEqual(budget_bytes);
    });

    it('never derives a heap that cannot hold the caps it returns', () => {
        // however small the budget, an ordinary commit must still parse
        for (const budget_bytes of [0, 8 * MB, 40 * MB, 100 * MB, 300 * MB, 4 * GiB]) {
            const limits = derive_limits({ budget_bytes, ...CAPS });
            expect(limits.max_parsed_bytes).toBeGreaterThanOrEqual(engine_module.MIN_PARSE_CAP_BYTES);
            expect(limits.max_commit_bytes).toBeGreaterThanOrEqual(engine_module.MIN_PARSE_CAP_BYTES);
            expect(limits.heap_limit_bytes).toBeGreaterThanOrEqual(heap_needed(limits));
            expect(limits.buffer_budget_bytes).toBeGreaterThanOrEqual(engine_module.MIN_BUFFER_BUDGET_BYTES);
        }
    });

    it('does not raise a cap configured below the minimum', () => {
        const limits = derive_limits({ budget_bytes: 8 * MB, max_parsed_bytes: 1024, max_commit_bytes: 2048, max_raw_elements: 10 });
        expect(limits.max_parsed_bytes).toBe(1024);
        expect(limits.max_commit_bytes).toBe(2048);
        expect(limits.max_raw_elements).toBe(10);
    });
});
