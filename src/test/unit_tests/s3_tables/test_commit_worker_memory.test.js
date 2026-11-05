/* Copyright (C) 2026 NooBaa */
'use strict';

const child_process = require('node:child_process');
const path = require('node:path');
const { CommitEngine, HEAP_ADMIT_FACTOR, HEAP_SIZING_FACTOR } = require('../../../sdk/s3_tables/engine');
const lossless_json = require('../../../sdk/s3_tables/lossless_json');
const fixtures = require('./s3_tables_fixtures');

/**
 * Run one transform straight on the real worker file at a given heap limit, bypassing
 * the engine's pre-flight refusal - which is exactly what makes it unsafe to run in
 * process. Prints `PROBE ok` on success; on failure it either prints the worker error
 * code or dies with a V8 FATAL ERROR, and the caller tells those two apart.
 *
 * argv: heap_mb, target_bytes
 */
const CHILD_PROBE = `
const { Worker } = require('node:worker_threads');
const heap_mb = Number(process.argv[1]);
const target = Number(process.argv[2]);
const parts = ['{"snapshots":['];
let size = 0;
for (let i = 0; size < target; ++i) {
    const id = '81031591497236' + String(10000 + (i % 10000));
    const t = (i ? ',' : '') + '{"snapshot-id":' + id + ',"parent-snapshot-id":' + id +
        ',"sequence-number":' + i + ',"timestamp-ms":1767225600000,"manifest-list":"s3://a--table-s3-nb/t/' +
        'metadata/snap-' + id + '-1-84e1dc8f-0b1c-4d2e-9f30-415263748596.avro","summary":{"operation":"append",' +
        '"added-records":"1200","total-records":"' + (i * 1200) + '"},"schema-id":0}';
    parts.push(t);
    size += t.length;
}
parts.push(']}');
const buf = Buffer.from(parts.join(''), 'utf8');
const w = new Worker(
    "const {parentPort}=require('node:worker_threads');" +
    "const lj=require(process.env.LJ);" +
    "parentPort.on('message', b => { const d = lj.parse(Buffer.from(b).toString('utf8'));" +
    " d.snapshots.push(d.snapshots[0]); parentPort.postMessage(Buffer.byteLength(lj.stringify(d))); });",
    { eval: true, env: { LJ: require.resolve('./src/sdk/s3_tables/lossless_json') },
      resourceLimits: { maxOldGenerationSizeMb: heap_mb } });
w.on('online', () => { const c = Buffer.from(buf); w.postMessage(c, [c.buffer]); });
w.on('message', n => { console.log('PROBE ok', n); w.terminate(); });
w.on('error', e => console.log('PROBE error', e.code));
`;

/**
 * The §12 test 19 measurements: main-thread event-loop lag while the worker transforms
 * a document at the 50 MB cap, and the heap that transform actually needs.
 *
 * **Opt-in**: `S3_TABLES_PERF_TESTS=1 npx jest test_commit_worker_memory`. Building a
 * 50 MB document and sweeping heap limits takes tens of seconds, and a timing assertion
 * on a shared CI runner is a flake waiting to happen. The correctness of the worker is
 * covered unconditionally by `test_commit_worker.test.js`; this file exists to produce
 * numbers for a human - and to let the heap factors in `engine.js` be
 * rechecked on the pinned Node and on Linux rather than taken on faith.
 */

const MB = 1024 * 1024;
const RUN = process.env.S3_TABLES_PERF_TESTS === '1';
const maybe_describe = RUN ? describe : describe.skip;

/**
 * @param {number} i
 * @returns {string} the JSON text of a snapshot whose id is outside the safe integer
 *      range, so the lossless reviver fires on it - which is what makes this the worst
 *      case for the parse this test is measuring
 */
function filler_snapshot_text(i) {
    const id = `81031591497236${String(10000 + (i % 10000))}`;
    return `{"snapshot-id":${id},"parent-snapshot-id":${id},"sequence-number":${i},` +
        `"timestamp-ms":${fixtures.NOW_MS - 1000},` +
        `"manifest-list":"${fixtures.TABLE_LOCATION}/metadata/snap-${id}-1-84e1dc8f-0b1c-4d2e-9f30-415263748596.avro",` +
        `"summary":{"operation":"append","added-data-files":"3","added-records":"1200",` +
        `"total-records":"${i * 1200}","total-files-size":"123456789"},"schema-id":0}`;
}

/**
 * A document just under `target_bytes`, almost all of it snapshots.
 *
 * **Built as text, not as an object graph.** Constructing 130,000 snapshot objects and
 * serializing them costs the *test process* the same ~4x the document that the worker
 * pays - which crashed this run with "Reached heap limit" before the worker was even
 * asked to do anything. Splicing text into the empty `snapshots` array of a real
 * initial document keeps the generator's own footprint to roughly the document size,
 * and leaves the result byte-for-byte a document the engine accepts.
 *
 * The length is accumulated as it builds rather than extrapolated from one element:
 * snapshots grow as their `total-records` field gains digits, and multiplying element
 * zero by the count lands the document over the cap, where every transform fails the
 * engine's input-size check instead of measuring anything.
 *
 * @param {number} target_bytes
 * @returns {Buffer}
 */
function worst_case_metadata(target_bytes) {
    const envelope = lossless_json.stringify(fixtures.initial_metadata());
    const marker = '"snapshots":[]';
    if (!envelope.includes(marker)) throw new Error('the initial document no longer has an empty snapshots array');
    let budget = target_bytes - envelope.length;
    const parts = [];
    for (let i = 0; budget > 0; ++i) {
        const text = filler_snapshot_text(i);
        budget -= text.length + 1; // +1 for the comma
        if (budget < 0) break;
        parts.push(text);
    }
    const document = envelope.replace(marker, `"snapshots":[${parts.join(',')}]`);
    const bytes = Buffer.from(document, 'utf8');
    if (bytes.byteLength > target_bytes) throw new Error(`generator overshot: ${bytes.byteLength} > ${target_bytes}`);
    return bytes;
}

function commit_ctx() {
    return {
        ...fixtures.make_ctx(),
        previous_metadata_location: fixtures.metadata_file_location(1),
    };
}

const commit_bytes = () => Buffer.from(JSON.stringify({
    requirements: [],
    updates: [{ action: 'set-properties', updates: { owner: 'perf' } }],
}), 'utf8');

/** @param {CommitEngine} engine */
async function transform(engine, metadata) {
    const commit = commit_bytes();
    const slot = await engine.acquire(commit.byteLength);
    try {
        slot.top_up(metadata.byteLength + commit.byteLength);
        return await engine.transform({
            metadata_bytes: metadata, commit_bytes: commit, ctx: commit_ctx(), slot,
        });
    } finally {
        slot.release();
    }
}

function percentile(sorted, p) {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

maybe_describe('commit worker - memory and event-loop lag (opt-in)', () => {

    it('keeps the main thread responsive while transforming a document at the cap', async () => {
        const engine = new CommitEngine({ max_parse_bytes: 50 * MB, budget_bytes: 2048 * MB });
        try {
            const metadata = worst_case_metadata(50 * MB);
            // captured now: transform() transfers the input, so after the call the
            // main thread's view of it is detached and reads as zero length
            const document_bytes = metadata.byteLength;
            // warm the worker so its ~17 ms startup is not counted as lag
            await transform(engine, worst_case_metadata(64 * 1024));

            const lags = [];
            let last = Date.now();
            const sampler = setInterval(() => {
                const now = Date.now();
                lags.push(now - last - 5);
                last = now;
            }, 5);
            // unref'd and cleared in a finally: a 5 ms interval left running by a failed
            // transform keeps the event loop alive and hangs the whole jest run
            sampler.unref();
            let result;
            let elapsed;
            try {
                const started = Date.now();
                result = await transform(engine, metadata);
                elapsed = Date.now() - started;
            } finally {
                clearInterval(sampler);
            }

            const sorted = lags.slice().sort((a, b) => a - b);
            console.log('[test 19] document %d MB, transform %d ms, main-thread lag p50 %d ms, p99 %d ms, max %d ms (%d samples)',
                Math.round(document_bytes / MB), elapsed,
                percentile(sorted, 0.5), percentile(sorted, 0.99), sorted[sorted.length - 1], sorted.length);

            expect(result.next_bytes.byteLength).toBeGreaterThan(document_bytes - MB);
            // Loose on purpose. Measured p99 is ~1 ms on an unloaded many-core machine
            // and the design predicts ~13 ms on a CPU-limited pod, where the worker
            // shares the quota with the main thread. The property under test is "the
            // main thread never parses", whose failure mode is a ~1 s stall, not 60 ms.
            expect(percentile(sorted, 0.99)).toBeLessThan(100);
        } finally {
            await engine.stop();
        }
    }, 300_000);

    it('reports the heap a document at the cap actually needs, and where containment fails', () => {
        // Each attempt runs in its own child process, and must: a worker whose heap
        // limit is *near* what the parse needs can abort the entire process with
        // "FATAL ERROR: Reached heap limit" rather than raising
        // ERR_WORKER_OUT_OF_MEMORY - which would take the jest run with it. Measured on
        // Node 24.4.1 against a 50 MB document: 128 MB clean, 160 MB and 192 MB abort,
        // 224 MB clean. That band is the reason engine.js refuses a transform up front
        // instead of letting the worker discover it, and this case is what would notice
        // if a Node upgrade moved the band.
        const results = [];
        let smallest_ok;
        for (const heap_mb of [128, 160, 192, 224, 256, 320, 384]) {
            const run_out = child_process.spawnSync(process.execPath,
                ['-e', CHILD_PROBE, String(heap_mb), String(50 * MB)],
                { encoding: 'utf8', timeout: 120_000, cwd: path.resolve(__dirname, '../../../..') });
            const stdout = run_out.stdout || '';
            const aborted = (run_out.stderr || '').includes('FATAL ERROR') || run_out.status === 134;
            const ok = stdout.includes('PROBE ok');
            let outcome = 'clean-oom';
            if (ok) outcome = 'ok';
            else if (aborted) outcome = 'PROCESS-ABORT';
            results.push(`${heap_mb}MB=${outcome}`);
            if (ok) {
                smallest_ok = heap_mb;
                break;
            }
        }
        console.log('[heap sweep] 50 MB document: %s', results.join(' '));
        console.log('[heap sweep] smallest heap that works = %s MB, i.e. %s x the document; ' +
            'engine.js admits at %dx and sizes at %dx',
            smallest_ok, smallest_ok && (smallest_ok * MB / (50 * MB)).toFixed(1),
            HEAP_ADMIT_FACTOR, HEAP_SIZING_FACTOR);
        expect(smallest_ok).toBeDefined();
        // the admission estimate has to stay above what a transform really needs, or the
        // engine dispatches work that lands in the process-abort band
        expect(smallest_ok * MB).toBeLessThanOrEqual(50 * MB * HEAP_ADMIT_FACTOR);
        // and the heap is sized above the admission estimate, so admitted work has room
        expect(HEAP_SIZING_FACTOR).toBeGreaterThan(HEAP_ADMIT_FACTOR);
    }, 600_000);
});
