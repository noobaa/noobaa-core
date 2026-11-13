/* Copyright (C) 2026 NooBaa */
'use strict';

const child_process = require('node:child_process');
const path = require('node:path');
const { CommitWorkerHost, derive_limits } = require('../../../sdk/s3_tables/s3_tables_commit_worker_host');
const lossless_json = require('../../../sdk/s3_tables/s3_tables_lossless_json');
const fixtures = require('./s3_tables_fixtures');

/**
 * Run one transform on the real worker file at a given heap limit, in a process of its
 * own. A transform that overran its heap inside one native call would abort the whole
 * process rather than the worker (design §8.3) - the failure this file exists to rule
 * out - so no attempt may share a process with the jest run.
 *
 * Prints `PROBE ok <output bytes>`, `PROBE refused <code>` for a semantic error, or
 * `PROBE error <code>` for a worker error; the caller reads an abort off the exit.
 *
 * argv: heap_mb, shape, size_bytes. env: ENVELOPE (an empty table), CTX.
 */
const CHILD_PROBE = `
const { Worker } = require('node:worker_threads');
const heap_mb = Number(process.argv[1]);
const shape = process.argv[2];
const size = Number(process.argv[3]);
const envelope = process.env.ENVELOPE;
const ctx = JSON.parse(process.env.CTX);

function repeat_to(size, item) {
    const parts = [];
    let bytes = 0;
    for (let i = 0; bytes < size; ++i) {
        const text = typeof item === 'function' ? item(i) : item;
        parts.push(text);
        bytes += text.length + 1;
    }
    return parts.join(',');
}
function snapshot(i) {
    const id = '81031591497236' + String(10000 + (i % 10000));
    return '{"snapshot-id":' + id + ',"parent-snapshot-id":' + id + ',"sequence-number":' + i +
        ',"timestamp-ms":1767225590000,"manifest-list":"s3://a--table-s3-nb/t/metadata/snap-' + id +
        '-1-84e1dc8f-0b1c-4d2e-9f30-415263748596.avro","summary":{"operation":"append",' +
        '"added-records":"1200","total-records":"' + (i * 1200) + '"},"schema-id":0}';
}
function splice(marker, replacement) {
    if (!envelope.includes(marker)) throw new Error('the envelope has no ' + marker);
    return envelope.replace(marker, replacement);
}
let document;
let commit = '{"requirements":[],"updates":[{"action":"set-properties","updates":{"owner":"perf"}}]}';
if (shape === 'snapshots') {
    document = splice('"snapshots":[]', '"snapshots":[' + repeat_to(size, snapshot) + ']');
} else if (shape === 'statistics_dense') {
    // one statistics entry whose bulk is empty objects: ~80 bytes of heap a byte, if parsed
    document = envelope.slice(0, -1) + ',"statistics":[{"snapshot-id":1,"blob-metadata":[' + repeat_to(size, '{}') + ']}]}';
} else if (shape === 'snapshots_empty') {
    document = splice('"snapshots":[]', '"snapshots":[' + repeat_to(size, '{}') + ']');
} else if (shape === 'properties_dense') {
    document = splice('"properties":{}', '"properties":{' + repeat_to(size, i => '"k' + i.toString(36) + '":""') + '}');
} else if (shape === 'caps_full') {
    // the two things a commit parses whole, each filled to its cap with the densest
    // shape there is: refs, which an append's requirement reads, and the request body
    const refs = '"refs":{"main":{"snapshot-id":7,"type":"branch"},"junk":[' +
        repeat_to(ctx.max_parsed_bytes - 4096, '{}') + ']}';
    document = splice('"snapshots":[]', '"current-snapshot-id":7,' + refs + ',"snapshots":[{"snapshot-id":7,"timestamp-ms":1}]')
        .replace('"current-snapshot-id":-1,', '').replace('"refs":{},', '');
    commit = '{"requirements":[{"type":"assert-ref-snapshot-id","ref":"main","snapshot-id":7}],' +
        '"updates":[{"action":"set-properties","updates":{"owner":"perf"}}],"junk":[' +
        repeat_to(ctx.max_commit_bytes - 4096, '{}') + ']}';
} else {
    throw new Error('unknown shape ' + shape);
}
const metadata_bytes = new Uint8Array(Buffer.from(document, 'utf8'));
const commit_bytes = new Uint8Array(Buffer.from(commit, 'utf8'));
document = undefined;
const w = new Worker('./src/sdk/s3_tables/s3_tables_commit_worker.js',
    { resourceLimits: { maxOldGenerationSizeMb: heap_mb } });
w.on('message', msg => {
    console.log(msg.ok ? 'PROBE ok ' + msg.next_bytes.byteLength : 'PROBE refused ' + (msg.error.s3_tables_code || msg.error.name) + ' ' + msg.error.message);
    w.terminate();
});
w.on('error', e => console.log('PROBE error', e.code));
w.postMessage({ id: 1, metadata_bytes, commit_bytes, ctx }, [metadata_bytes.buffer, commit_bytes.buffer]);
`;

/**
 * @param {number} heap_mb
 * @param {string} shape
 * @param {number} size_bytes
 * @param {object} [ctx_overrides]
 * @returns {string} 'ok', 'refused <code>', 'clean-oom', or 'PROCESS-ABORT'
 */
function probe(heap_mb, shape, size_bytes, ctx_overrides) {
    const ctx = {
        ...fixtures.make_ctx(ctx_overrides),
        previous_metadata_location: fixtures.metadata_file_location(1),
        max_document_bytes: 64 * 1024 * 1024,
        max_parse_bytes: 64 * 1024 * 1024,
    };
    const run_out = child_process.spawnSync(process.execPath,
        ['-e', CHILD_PROBE, String(heap_mb), shape, String(size_bytes)], {
            encoding: 'utf8',
            timeout: 180_000,
            cwd: path.resolve(__dirname, '../../../..'),
            env: {
                ...process.env,
                ENVELOPE: lossless_json.stringify(fixtures.initial_metadata()),
                CTX: JSON.stringify(ctx),
            },
        });
    const stdout = run_out.stdout || '';
    const line = stdout.split('\n').find(text => text.startsWith('PROBE '));
    if (line && line.startsWith('PROBE ok')) return 'ok';
    if (line && line.startsWith('PROBE refused')) return `refused ${line.split(' ')[2]}`;
    if (line && line.includes('ERR_WORKER_OUT_OF_MEMORY')) return 'clean-oom';
    if ((run_out.stderr || '').includes('FATAL ERROR') || run_out.status === 134 || run_out.signal) return 'PROCESS-ABORT';
    return `unexpected: ${(line || run_out.stderr || '').slice(0, 200)}`;
}

/**
 * The §12 test 19 measurements: main-thread event-loop lag while the worker transforms
 * a document at the 50 MB cap, and the heap that transform actually needs.
 *
 * **Opt-in**: `S3_TABLES_PERF_TESTS=1 npx jest test_commit_worker_memory`. Building a
 * 50 MB document and sweeping heap limits takes tens of seconds, and a timing assertion
 * on a shared CI runner is a flake waiting to happen. The correctness of the worker is
 * covered unconditionally by `test_commit_worker.test.js`; this file exists to produce
 * numbers for a human - and to let the heap sizing in `s3_tables_commit_worker_host.js` be
 * rechecked on the pinned Node and on Linux rather than taken on faith.
 */

const MB = 1024 * 1024;
const RUN = process.env.S3_TABLES_PERF_TESTS === '1';
const maybe_describe = RUN ? describe : describe.skip;

/**
 * @param {number} i
 * @returns {string} the JSON text of a snapshot whose id is outside the safe integer
 *      range, as nearly every real snapshot id is
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

/** @param {CommitWorkerHost} engine */
async function transform(engine, metadata) {
    const commit = commit_bytes();
    return engine.admit(metadata.byteLength + commit.byteLength, () =>
        engine.transform({ metadata_bytes: metadata, commit_bytes: commit, ctx: commit_ctx() }));
}

function percentile(sorted, p) {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

maybe_describe('commit worker - memory and event-loop lag (opt-in)', () => {

    it('keeps the main thread responsive while transforming a document at the cap', async () => {
        const engine = new CommitWorkerHost({ max_parse_bytes: 50 * MB, budget_bytes: 2048 * MB });
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
            // main thread never reads the document", whose failure mode is a stall of
            // hundreds of milliseconds, not 60 ms.
            expect(percentile(sorted, 0.99)).toBeLessThan(100);
        } finally {
            await engine.stop();
        }
    }, 300_000);

    it('needs the same worker heap whatever the size of the document', () => {
        // The transform never parses the stored document, so the heap a commit needs is
        // set by what it reads - a few kilobytes here - and not by the document. This is
        // what lets the host give the worker a fixed heap (§8.1, §8.3).
        const LIMITS = [4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 320];
        const smallest = {};
        for (const size_mb of [1, 10, 50]) {
            const results = [];
            for (const heap_mb of LIMITS) {
                const outcome = probe(heap_mb, 'snapshots', size_mb * MB);
                results.push(`${heap_mb}MB=${outcome}`);
                // below what it needs the worker must fail by itself, never take the process
                expect(outcome).not.toBe('PROCESS-ABORT');
                if (outcome === 'ok') {
                    smallest[size_mb] = heap_mb;
                    break;
                }
            }
            console.log('[heap sweep] %d MB document: %s', size_mb, results.join(' '));
        }
        console.log('[heap sweep] smallest heap that works: %j', smallest);
        expect(smallest[50]).toBeDefined();
        // flat: fifty times the document may not cost more than a step of the sweep
        expect(smallest[50]).toBeLessThanOrEqual(Math.max(smallest[1] * 2, 16));
        expect(smallest[50]).toBeLessThanOrEqual(32);
    }, 900_000);

    it('ends every hostile document in a commit or a refusal, never a dead worker or a dead process', () => {
        // the heap and the caps the default deployment runs with
        const limits = derive_limits({
            budget_bytes: 768 * MB, max_parsed_bytes: MB, max_commit_bytes: MB, max_raw_elements: 1000000,
        });
        const heap_mb = Math.ceil(limits.heap_limit_bytes / MB);
        const cases = [
            // dense content in a stored element is copied, never parsed
            ['statistics_dense', 20 * MB, 'ok'],
            // seven million elements would cost the index ~170 MB outside the heap
            ['snapshots_empty', 20 * MB, 'refused InvalidRequest'],
            // properties is read by every commit, and this one is 16 times the parse cap
            ['properties_dense', 16 * MB, 'refused InvalidRequest'],
            // both things a commit does parse, each full of the densest shape there is:
            // the case the heap is sized for, so it has to simply work
            ['caps_full', 0, 'ok'],
        ];
        const outcomes = cases.map(([shape, size]) => probe(heap_mb, shape, size));
        console.log('[hostile] heap %d MB: %s', heap_mb, cases.map(([shape], i) => `${shape}=${outcomes[i]}`).join(' '));
        expect(outcomes).toEqual(cases.map(([, , expected]) => expected));

        // and the caps a dev-sized pod derives hold in the heap that pod derives
        const dev = derive_limits({
            budget_bytes: 125 * MB, max_parsed_bytes: MB, max_commit_bytes: MB, max_raw_elements: 1000000,
        });
        const dev_outcome = probe(Math.ceil(dev.heap_limit_bytes / MB), 'caps_full', 0,
            { max_parsed_bytes: dev.max_parsed_bytes, max_commit_bytes: dev.max_commit_bytes });
        console.log('[hostile] dev pod, heap %d MB, caps %d bytes: caps_full=%s',
            Math.ceil(dev.heap_limit_bytes / MB), dev.max_parsed_bytes, dev_outcome);
        expect(dev_outcome).toBe('ok');
    }, 900_000);
});
