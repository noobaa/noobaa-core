/* Copyright (C) 2026 NooBaa */
'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const { Semaphore } = require('../../util/semaphore');
const errors = require('./s3_tables_errors');
const { detachable, byte_length } = require('./s3_tables_transfer_utils');

/**
 * The main-thread side of the metadata engine (design §8.3): worker lifecycle, request
 * correlation, admission control and failure classification.
 *
 * The main thread never parses metadata. It hands two opaque byte buffers to the worker
 * and receives one back, transferring rather than copying, so a commit at the 50 MB cap
 * costs it no full-document traversal and no event-loop stall.
 *
 * Everything here is sized from the slice of the pod this process may use, and nothing
 * from any document: the transform never parses a stored document whole (§8.1), so the
 * worker's heap is a constant derived from the parse caps. See {@link derive_limits}.
 */

const WORKER_PATH = path.join(__dirname, 's3_tables_commit_worker.js');

/** Everything here is in bytes; Node's resourceLimits is the one place that is not. */
const MB = 1024 * 1024;

/**
 * Worker old-space per byte the transform passes to `JSON.parse`.
 *
 * Heap need follows the number of JSON values, not the bytes, and the densest input
 * measured - an array of empty objects - needs about 80 bytes of heap per byte of text
 * (Node 24). The transform parses at most `max_commit_bytes` of request and
 * `max_parsed_bytes` of stored document (§8.1), so this factor times their sum bounds
 * the heap whatever a client sends. It is the measured worst case with half again on
 * top, because the measurement is a sample of shapes and not a proof.
 *
 * **Why the bound has to hold by construction.** `resourceLimits` does not reliably
 * contain a heap overrun: when one native `JSON.parse` fills the heap, V8 can abort the
 * whole process with `FATAL ERROR: Reached heap limit` instead of raising
 * `ERR_WORKER_OUT_OF_MEMORY` in the worker. Measured with a whole-document parse of a
 * 50 MB document needing 256 MB: a 128 MB limit failed cleanly, 160 and 192 MB aborted
 * the process, 224 MB failed cleanly. There is no safely-too-small limit, so the only
 * safe design is one where no single parse can be large.
 */
const PARSE_HEAP_FACTOR = 120;
/** The engine itself, and the id sets a large `remove-snapshots` builds. */
const HEAP_BASE_BYTES = 16 * MB;
/** The heap's share of the tables budget, at most. The rest is what commits are admitted against. */
const HEAP_BUDGET_DIVISOR = 3;
/**
 * A parse cap is never scaled below this. An ordinary append is a few kilobytes of
 * request and reads a few kilobytes of the document, so a pod too small for the
 * configured caps still serves ordinary tables.
 */
const MIN_PARSE_CAP_BYTES = 64 * 1024;
/**
 * What the index of a raw list costs per element, outside the V8 heap: six `Int32Array`
 * slots (`s3_tables_json_index.js`), doubled for the copy made each time it grows.
 */
const INDEX_BYTES_PER_ELEMENT = 48;
/** The index's share of the tables budget, at most. */
const INDEX_BUDGET_DIVISOR = 16;
const MIN_RAW_ELEMENTS = 10000;
/** Node rejects or misbehaves on an absurdly small old-space limit. */
const MIN_RESOURCE_LIMIT_BYTES = 16 * MB;
/**
 * What a worker costs *outside* old-space - V8 itself, new space, code, the loaded
 * engine. `maxOldGenerationSizeMb` does not cover it, so it is subtracted explicitly
 * rather than hidden inside a fudge factor on the heap limit.
 */
const WORKER_BASELINE_BYTES = 32 * MB;
/**
 * Admission never collapses to zero. Without a floor the budget subtraction goes
 * negative on a small pod and *every* commit is throttled, including the 10 KB ones
 * that are the common case - dead rather than degraded.
 */
const MIN_BUFFER_BUDGET_BYTES = 16 * MB;
/** So a flood of tiny commits cannot each charge ~0 and slip the bound. */
const MIN_CHARGE_BYTES = 64 * 1024;
/**
 * What a commit holds in buffers, per byte of its two inputs: the inputs themselves,
 * and the output - which is at most as large as both together, since everything an
 * update adds comes from the request, and which is resident beside the input until the
 * worker's copy of the input is collected.
 */
const COMMIT_CHARGE_FACTOR = 2;
/**
 * The bounded queue of §8.3, expressed the way the rest of the codebase expresses one:
 * the semaphore rejects a waiter that has waited this long, and the host renders that
 * as `Throttled` (429). Bounding the wait rather than the queue's depth is what the
 * client actually experiences, and it is the mechanism `object_io` already uses
 * (`config.IO_STREAM_SEMAPHORE_TIMEOUT`, `src/sdk/object_io.js:128`).
 *
 * The process's instance takes its value from `config.S3_TABLES_ADMISSION_TIMEOUT_MS`;
 * this is the default for a host built without one.
 */
const ADMISSION_TIMEOUT_MS = 30 * 1000;
const ADMISSION_TIMEOUT_CODE = 'S3_TABLES_ADMISSION_TIMEOUT';
/**
 * Under this size, memory pressure is not a credible explanation for a worker OOM, so
 * it is reported as a defect (TransientFailure) rather than as capacity (Throttled).
 */
const MIN_OOM_THROTTLE_BYTES = MB;
/**
 * V8 does not return a grown old-space to the OS, so a process that served one heavy
 * commit would hold whatever the worker's heap grew to for the life of the pod. Five
 * minutes is long enough that a steadily committing table never pays the ~17 ms
 * respawn, short enough that a one-off commit gives its memory back.
 */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

// ///////////////////////////////////////////////////////////////////////////////////
// sizing
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * How much of the pod's memory belongs to this process.
 *
 * Forks are separate processes under one cgroup limit, so a process sizing itself from
 * the whole pod would let N forks claim N times the pod (§14's memory risk).
 *
 * **`config.CONTAINER_MEM_LIMIT` is not always pod-wide.** It is
 * `env.CONTAINER_MEM_LIMIT || config.OS_MEM_LIMIT` (`config.js:46`), and `OS_MEM_LIMIT`
 * has *already* been divided by `ENDPOINT_FORKS` (`config.js:28`). Dividing it again
 * would halve twice whenever the variable is unset. The operator sets it from `limits.memory` through the downward API, so the
 * containerized path divides once; dev and NSFS, which are where forks are actually
 * used, take the already-divided value.
 *
 * Pure, so the four cases are unit-testable without reloading `config`.
 *
 * @param {{ container_env?: string, container_mem_limit: number, os_mem_limit: number, forks: number }} p
 * @returns {number} bytes
 */
function fork_share_bytes({ container_env, container_mem_limit, os_mem_limit, forks }) {
    if (container_env) return container_mem_limit / Math.max(forks, 1);
    return os_mem_limit;
}

/**
 * Split this process's tables budget into its fixed parts (§8.3). Nothing here depends
 * on a document:
 *
 * 1. the worker heap - sized from the two parse caps, the line no transform can reach;
 * 2. the worker's non-heap cost - `WORKER_BASELINE_BYTES`;
 * 3. the index of a document's raw lists - sized from the element cap, outside the heap;
 * 4. commit buffers - what is left, and the only part admission meters: the two inputs
 *    and the output of every admitted commit.
 *
 * On a budget too small for the configured caps the heap takes at most a third of it
 * and the caps shrink to what that heap can hold; the element cap shrinks with the
 * index reserve the same way. The caps returned here are the ones this process
 * enforces - the host sets them on every transform it dispatches.
 *
 * Pure, for the same reason as above.
 *
 * @param {{
 *      budget_bytes: number,
 *      max_parsed_bytes: number,
 *      max_commit_bytes: number,
 *      max_raw_elements: number,
 * }} p
 * @returns {{
 *      heap_limit_bytes: number,
 *      index_reserve_bytes: number,
 *      buffer_budget_bytes: number,
 *      max_parsed_bytes: number,
 *      max_commit_bytes: number,
 *      max_raw_elements: number,
 *      scaled: boolean,
 * }}
 */
function derive_limits({ budget_bytes, max_parsed_bytes, max_commit_bytes, max_raw_elements }) {
    const heap_for = (parsed, commit) => HEAP_BASE_BYTES + (PARSE_HEAP_FACTOR * (parsed + commit));
    const wanted_heap = heap_for(max_parsed_bytes, max_commit_bytes);
    // never below what the smallest caps need: a worker that cannot parse an ordinary
    // commit makes the feature fail opaquely, where small caps fail an oversized one
    // with an honest 400
    const floor_heap = heap_for(
        Math.min(max_parsed_bytes, MIN_PARSE_CAP_BYTES),
        Math.min(max_commit_bytes, MIN_PARSE_CAP_BYTES));
    const heap_limit_bytes = Math.max(
        Math.min(wanted_heap, Math.floor(budget_bytes / HEAP_BUDGET_DIVISOR)),
        floor_heap,
        MIN_RESOURCE_LIMIT_BYTES);
    const scale = Math.min(1, (heap_limit_bytes - HEAP_BASE_BYTES) / (wanted_heap - HEAP_BASE_BYTES));
    const scaled_cap = cap => Math.min(cap, Math.max(Math.floor(cap * scale), MIN_PARSE_CAP_BYTES));

    const index_reserve_bytes = Math.min(
        max_raw_elements * INDEX_BYTES_PER_ELEMENT,
        Math.max(Math.floor(budget_bytes / INDEX_BUDGET_DIVISOR), MIN_RAW_ELEMENTS * INDEX_BYTES_PER_ELEMENT));
    const elements = Math.min(max_raw_elements, Math.floor(index_reserve_bytes / INDEX_BYTES_PER_ELEMENT));

    const buffer_budget_bytes = Math.max(
        budget_bytes - heap_limit_bytes - WORKER_BASELINE_BYTES - index_reserve_bytes,
        MIN_BUFFER_BUDGET_BYTES);
    return {
        heap_limit_bytes,
        index_reserve_bytes,
        buffer_budget_bytes,
        max_parsed_bytes: scaled_cap(max_parsed_bytes),
        max_commit_bytes: scaled_cap(max_commit_bytes),
        max_raw_elements: elements,
        // this deployment enforces smaller caps than the configured ones
        scaled: scale < 1 || elements < max_raw_elements,
    };
}

/**
 * The only place that reads `config`.
 * @returns {{
 *      max_parse_bytes: number,
 *      max_parsed_bytes: number,
 *      max_commit_bytes: number,
 *      max_raw_elements: number,
 *      budget_bytes: number,
 *      admission_timeout_ms: number,
 * }}
 */
function size_from_config() {
    const share = fork_share_bytes({
        container_env: process.env.CONTAINER_MEM_LIMIT,
        container_mem_limit: config.CONTAINER_MEM_LIMIT,
        os_mem_limit: config.OS_MEM_LIMIT,
        forks: config.ENDPOINT_FORKS,
    });
    return {
        max_parse_bytes: config.S3_TABLES_MAX_METADATA_PARSE_BYTES,
        max_parsed_bytes: config.S3_TABLES_MAX_PARSED_BYTES,
        max_commit_bytes: config.S3_TABLES_MAX_COMMIT_BYTES,
        max_raw_elements: config.S3_TABLES_MAX_RAW_ELEMENTS,
        budget_bytes: Math.floor(share * config.S3_TABLES_MEM_FRACTION),
        admission_timeout_ms: config.S3_TABLES_ADMISSION_TIMEOUT_MS,
    };
}

// ///////////////////////////////////////////////////////////////////////////////////
// errors across the thread boundary
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * Rebuild what `s3_tables_commit_worker.serialize_error()` flattened. A semantic error comes back
 * as itself; anything else - a TypeError from `assert_ctx`, say - comes back as a plain
 * Error with the worker's name, message and stack, rather than being dressed up as a
 * semantic error it is not. The commit path renders an unexpected error at the
 * transform stage as TransientFailure (§7.2).
 * @param {{ s3_tables_code?: string, message: string, details?: object, name: string, stack?: string }} e
 * @returns {Error}
 */
function rebuild_error(e) {
    if (e.s3_tables_code) {
        const err = new errors.S3TablesError({ code: e.s3_tables_code, message: e.message }, e.message, e.details);
        if (e.stack) err.stack = e.stack;
        return err;
    }
    const err = new Error(e.message);
    err.name = e.name || 'Error';
    if (e.stack) err.stack = e.stack;
    // @ts-ignore - marking provenance for the commit path's logs
    err.code = 'S3TABLES_WORKER_ERROR';
    return err;
}

// ///////////////////////////////////////////////////////////////////////////////////
// the host
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * @typedef {{
 *      id: number,
 *      metadata_bytes: Buffer|Uint8Array|string,
 *      commit_bytes: Buffer|Uint8Array|string,
 *      ctx: object,
 *      bytes: number,
 *      resolve: (value: any) => void,
 *      reject: (err: any) => void,
 * }} PendingTransform
 */

class CommitWorkerHost {

    /**
     * @param {{
     *      max_parse_bytes: number,
     *      budget_bytes: number,
     *      max_parsed_bytes?: number,
     *      max_commit_bytes?: number,
     *      max_raw_elements?: number,
     *      heap_limit_bytes?: number,
     *      buffer_budget_bytes?: number,
     *      max_workers?: number,
     *      idle_timeout_ms?: number,
     *      admission_timeout_ms?: number,
     * }} params The three caps default to the shipped configuration.
     *      `heap_limit_bytes` and `buffer_budget_bytes` override the derivation; they
     *      exist so tests can build a host with limits small enough to exhaust.
     */
    constructor(params) {
        const { max_parse_bytes, budget_bytes } = params;
        const derived = derive_limits({
            budget_bytes,
            max_parsed_bytes: params.max_parsed_bytes ?? MB,
            max_commit_bytes: params.max_commit_bytes ?? MB,
            max_raw_elements: params.max_raw_elements ?? 1000000,
        });
        this.max_parse_bytes = max_parse_bytes;
        this.budget_bytes = budget_bytes;
        this.heap_limit_bytes = params.heap_limit_bytes ?? derived.heap_limit_bytes;
        this.buffer_budget_bytes = params.buffer_budget_bytes ?? derived.buffer_budget_bytes;
        // the caps this process enforces, set on every transform it dispatches
        this.max_parsed_bytes = derived.max_parsed_bytes;
        this.max_commit_bytes = derived.max_commit_bytes;
        this.max_raw_elements = derived.max_raw_elements;
        // One worker, by choice rather than by necessity (§8.3). Each worker reserves a
        // heap and an index of its own, so a second one buys parallelism by taking that
        // from admission; and the endpoint is main-thread bound, so on the default
        // profile's CPU limit the headroom above a saturated main thread is about one
        // core. The dispatch path below is written against a set of workers so that
        // raising this is picking an idle worker instead of the worker.
        this.max_workers = params.max_workers ?? 1;
        this.idle_timeout_ms = params.idle_timeout_ms ?? IDLE_TIMEOUT_MS;
        this.admission_timeout_ms = params.admission_timeout_ms ?? ADMISSION_TIMEOUT_MS;

        // A counting semaphore over *bytes*, as buffer_utils.BuffersPool uses one
        // (src/util/buffer_utils.js:251), with the timeout that makes its wait queue
        // bounded, as object_io does (src/sdk/object_io.js:128).
        this._sem = new Semaphore(this.buffer_budget_bytes, {
            timeout: this.admission_timeout_ms,
            timeout_error_code: ADMISSION_TIMEOUT_CODE,
        });
        /** @type {{ worker: import('node:worker_threads').Worker, current: PendingTransform|null }[]} */
        this._workers = [];
        /** @type {PendingTransform[]} */
        this._queue = [];
        this._seq = 0;
        this._idle_timer = null;
        this._stopped = false;
        this._worker_restarts = 0;
        this._oom_count = 0;

        dbg.log0('CommitWorkerHost sizing:', {
            max_parse_bytes,
            budget_bytes,
            heap_limit_bytes: this.heap_limit_bytes,
            buffer_budget_bytes: this.buffer_budget_bytes,
            max_parsed_bytes: this.max_parsed_bytes,
            max_commit_bytes: this.max_commit_bytes,
            max_raw_elements: this.max_raw_elements,
            max_workers: this.max_workers,
        });
        if (derived.scaled) {
            dbg.warn('CommitWorkerHost: this deployment is too small for the configured parse caps and ' +
                `enforces smaller ones: ${this.max_parsed_bytes} bytes of metadata parsed per commit, ` +
                `${this.max_commit_bytes} bytes of commit request, ${this.max_raw_elements} array elements. ` +
                'Raise the endpoint memory limit or config.S3_TABLES_MEM_FRACTION.');
        }
        if (this.buffer_budget_bytes < max_parse_bytes * COMMIT_CHARGE_FACTOR) {
            dbg.warn('CommitWorkerHost: this deployment cannot commit to a metadata document at the ' +
                `configured cap. A ${Math.round(max_parse_bytes / MB)} MB document charges ` +
                `${Math.round(max_parse_bytes * COMMIT_CHARGE_FACTOR / MB)} MB and the commit buffer budget is ` +
                `${Math.round(this.buffer_budget_bytes / MB)} MB. Commits to larger tables will be ` +
                'rejected as Throttled. Raise the endpoint memory limit or config.S3_TABLES_MEM_FRACTION.');
        }
    }

    get stats() {
        return {
            workers: this._workers.length,
            in_flight: this._workers.filter(slot => slot.current).length,
            queued: this._queue.length,
            held_bytes: this.buffer_budget_bytes - this._sem.value,
            worker_restarts: this._worker_restarts,
            oom_count: this._oom_count,
        };
    }

    // ----- admission -------------------------------------------------------------

    /**
     * Reserve main-thread bytes for the duration of one commit, and run it.
     *
     * **Call this knowing the real size, and before allocating the bytes.** The caller
     * learns the current `metadata.json`'s size from `read_object_md` - the pointer read
     * it already does tells it where to look - and only then fetches the document,
     * inside `fn`. That ordering is the whole mechanism: a reservation taken *after* the
     * buffer exists reports on the peak instead of bounding it, and with N commits
     * arriving together all N documents would be resident before the first one was
     * refused.
     *
     * What this bounds is **arrivals**, not transform concurrency - the worker is serial
     * anyway. Every commit in flight holds its fetched document and its request body on
     * the main thread while it waits for the worker, and a serial consumer with
     * unbounded arrivals is a queue made of 50 MB buffers (§8.3).
     *
     * The charge is twice the size passed: the two inputs, and the output they become
     * (`COMMIT_CHARGE_FACTOR`).
     *
     * Two ways to be refused, both rendered as `Throttled` (429, §7.3):
     * - a commit larger than the entire budget, refused at once: no release could ever
     *   satisfy it, and the semaphore is fair, so letting it queue would block every
     *   waiter behind it until it timed out;
     * - a wait beyond the admission timeout, which is §8.3's bounded queue, using the
     *   semaphore's own timeout as `object_io` does (`src/sdk/object_io.js:128`).
     *
     * There is no check that the document fits the worker heap, because the heap does
     * not depend on the document (§8.1).
     *
     * A size that is not a number is a caller bug and throws a `TypeError`. It is not
     * charged a default: a commit path that lost `object_info.size` would otherwise
     * run every commit at the minimum charge, and the budget would bound nothing.
     *
     * Releasing is not the caller's job - a throw or an early return inside `fn` cannot
     * leak a reservation.
     *
     * @template T
     * @param {number|string} bytes the size of the two inputs together - the document
     *      plus the request body - before either is read. A decimal string is accepted because a
     *      `Content-Length` arrives from HTTP as one.
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async admit(bytes, fn) {
        // Normalized, because Semaphore's to_sem_count() turns a non-number into 1:
        // passing a Content-Length string raw would charge one byte and silently defeat
        // the budget.
        const size = typeof bytes === 'string' && bytes.trim() !== '' ? Number(bytes) : bytes;
        if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
            throw new TypeError(`admit() requires the commit's size in bytes, got ${String(bytes)}`);
        }
        const cost = Math.max(Math.ceil(size) * COMMIT_CHARGE_FACTOR, MIN_CHARGE_BYTES);
        if (cost > this.buffer_budget_bytes) {
            throw errors.throttled(
                `a commit of ${cost} bytes exceeds this endpoint's entire commit buffer budget ` +
                `of ${this.buffer_budget_bytes} bytes`);
        }
        try {
            return await this._sem.surround_count(cost, fn);
        } catch (err) {
            if (err.code !== ADMISSION_TIMEOUT_CODE) throw err;
            throw errors.throttled(`waited over ${this.admission_timeout_ms} ms for commit buffer capacity`);
        }
    }

    // ----- the transform ---------------------------------------------------------

    /**
     * Run one transform in a worker.
     *
     * **Call this inside {@link CommitWorkerHost#admit}.** It does not check, and
     * cannot: the reservation has to be taken before the document is read, which is
     * before this call. A commit that reaches the worker unadmitted holds its bytes
     * against no budget, and the symptom is a pod killed under load rather than
     * anything visible here.
     *
     * Every refusal is a rejected promise, never a synchronous throw.
     *
     * @param {{
     *      metadata_bytes: Buffer|Uint8Array|string,
     *      commit_bytes: Buffer|Uint8Array|string,
     *      ctx: object,
     * }} params
     * @returns {Promise<{ next_bytes: Buffer, header: object }>}
     */
    transform({ metadata_bytes, commit_bytes, ctx }) {
        if (this._stopped) return Promise.reject(errors.transient_failure('the metadata engine is shutting down'));
        const bytes = byte_length(metadata_bytes) + byte_length(commit_bytes);
        this._seq += 1;
        const id = this._seq;
        return new Promise((resolve, reject) => {
            this._queue.push({ id, metadata_bytes, commit_bytes, ctx, bytes, resolve, reject });
            this._pump();
        });
    }

    /** Feed every idle worker, spawning one if allowed. */
    _pump() {
        while (this._queue.length) {
            const slot = this._idle_worker();
            if (!slot) return;
            const entry = this._queue.shift();
            slot.current = entry;
            this._cancel_idle_timer();
            slot.worker.ref();
            // Transfer, do not copy: a 50 MB postMessage costs ~15 ms of main-thread copy
            // otherwise. detachable() guards the pooled-small-buffer hazard it opens.
            const md = detachable(entry.metadata_bytes);
            const cb = detachable(entry.commit_bytes);
            // the caps are this process's, not the caller's: they are what the heap
            // this worker was started with can hold
            const ctx = {
                ...entry.ctx,
                max_parsed_bytes: this.max_parsed_bytes,
                max_commit_bytes: this.max_commit_bytes,
                max_raw_elements: this.max_raw_elements,
            };
            slot.worker.postMessage(
                { id: entry.id, metadata_bytes: md, commit_bytes: cb, ctx },
                [md.buffer, cb.buffer]);
        }
    }

    /**
     * An idle worker, or a new one if we are under the limit. Dispatching one request at
     * a time per worker is what makes a death attributable: the worker that died was
     * running exactly one known request, so nothing else has to be failed with it.
     */
    _idle_worker() {
        const idle = this._workers.find(slot => !slot.current);
        if (idle) return idle;
        if (this._workers.length >= this.max_workers || this._stopped) return undefined;
        return this._spawn();
    }

    _spawn() {
        const worker = new Worker(WORKER_PATH, {
            // the one API in this module that speaks megabytes rather than bytes, so
            // the clamp happens in bytes and the conversion exactly once
            resourceLimits: {
                maxOldGenerationSizeMb: Math.ceil(
                    Math.max(this.heap_limit_bytes, MIN_RESOURCE_LIMIT_BYTES) / MB),
            },
        });
        const slot = { worker, current: null };
        worker.on('message', msg => this._on_message(slot, msg));
        worker.on('error', err => this._on_worker_down(slot, err));
        worker.on('exit', code => this._on_worker_down(slot, code ? new Error(`worker exited with code ${code}`) : null));
        // never hold the process open on an idle worker; _pump() refs it while busy
        worker.unref();
        this._workers.push(slot);
        return slot;
    }

    /**
     * @param {{ worker: import('node:worker_threads').Worker, current: PendingTransform|null }} slot
     * @param {{ id: number, ok: boolean, next_bytes?: Uint8Array, header?: object, error?: any }} msg
     */
    _on_message(slot, msg) {
        const entry = slot.current;
        if (!entry || entry.id !== msg.id) {
            dbg.warn('CommitWorkerHost: dropping a worker message with no matching request', msg.id);
            return;
        }
        slot.current = null;
        slot.worker.unref();
        if (msg.ok) {
            // a view over the transferred ArrayBuffer - still no copy
            const out = msg.next_bytes;
            entry.resolve({
                next_bytes: Buffer.from(out.buffer, out.byteOffset, out.byteLength),
                header: msg.header,
            });
        } else {
            entry.reject(rebuild_error(msg.error));
        }
        this._pump();
        this._maybe_idle();
    }

    /**
     * A worker died. Both `error` and `exit` fire, so the first one through detaches the
     * slot and the second finds it gone.
     *
     * @param {{ worker: import('node:worker_threads').Worker, current: PendingTransform|null }} slot
     * @param {Error|null} err
     */
    _on_worker_down(slot, err) {
        const index = this._workers.indexOf(slot);
        if (index < 0) return; // already handled, or already stopped
        this._workers.splice(index, 1);
        const entry = slot.current;
        slot.current = null;
        if (entry) {
            this._worker_restarts += 1;
            entry.reject(this._classify_death(err, entry));
        }
        // Queued requests were never posted into this worker, so they are untouched -
        // _pump() runs them on a fresh one.
        if (!this._stopped) this._pump();
        this._maybe_idle();
    }

    /**
     * §7.2: every transform failure is "definitely not committed", because the transform
     * is pure and precedes every write. The only question is which honest code to send.
     *
     * Heap exhaustion should not happen at all - the parse caps bound what a transform
     * can allocate (§8.1) - so when it does it is a defect in that bound. It is still
     * reported honestly: Throttled (429) rather than TransientFailure (409), which
     * would tell the client to reload and retry a commit that will fail the same way.
     *
     * @param {Error|null} err
     * @param {PendingTransform} entry
     * @returns {Error}
     */
    _classify_death(err, entry) {
        // @ts-ignore - Node sets .code on the worker error
        if (err && err.code === 'ERR_WORKER_OUT_OF_MEMORY') {
            this._oom_count += 1;
            if (entry.bytes >= MIN_OOM_THROTTLE_BYTES) {
                dbg.warn('CommitWorkerHost: the transform worker ran out of memory', {
                    document_bytes: entry.bytes,
                    heap_limit_bytes: this.heap_limit_bytes,
                });
                return errors.throttled(
                    `this endpoint cannot transform a ${entry.bytes} byte metadata document: ` +
                    `its commit worker heap limit is ${this.heap_limit_bytes} bytes`);
            }
            // at this size memory pressure is not a credible explanation
            dbg.error('CommitWorkerHost: the transform worker ran out of memory on a small document',
                { document_bytes: entry.bytes, heap_limit_bytes: this.heap_limit_bytes });
            return errors.transient_failure('the metadata transform worker ran out of memory');
        }
        dbg.warn('CommitWorkerHost: the transform worker died', err && err.message);
        return errors.transient_failure('the metadata transform worker exited before completing the commit');
    }

    // ----- idle ------------------------------------------------------------------

    _maybe_idle() {
        if (this._stopped || this._idle_timer) return;
        if (this._queue.length || this._workers.some(slot => slot.current)) return;
        if (!this._workers.length) return;
        this._idle_timer = setTimeout(() => {
            this._idle_timer = null;
            // a request may have arrived while the timer was pending
            if (this._queue.length || this._workers.some(slot => slot.current)) return;
            dbg.log0('CommitWorkerHost: terminating the idle transform worker');
            this._terminate_all();
        }, this.idle_timeout_ms);
        this._idle_timer.unref();
    }

    _cancel_idle_timer() {
        if (!this._idle_timer) return;
        clearTimeout(this._idle_timer);
        this._idle_timer = null;
    }

    _terminate_all() {
        const slots = this._workers;
        this._workers = [];
        return Promise.all(slots.map(slot => slot.worker.terminate()));
    }

    /** Terminate the worker and fail anything outstanding. For shutdown and for tests. */
    async stop() {
        this._stopped = true;
        this._cancel_idle_timer();
        const outstanding = [
            ...this._workers.map(slot => slot.current),
            ...this._queue.splice(0),
        ].filter(Boolean);
        await this._terminate_all();
        for (const entry of outstanding) {
            entry.reject(errors.transient_failure('the metadata engine stopped before the commit was transformed'));
        }
    }
}

// ///////////////////////////////////////////////////////////////////////////////////
// the per-process instance
// ///////////////////////////////////////////////////////////////////////////////////

/** @type {CommitWorkerHost} */
let singleton;

/**
 * The process's host, built on first use. Lazy because a pod that never serves a
 * commit should never size, spawn or log anything.
 * @returns {CommitWorkerHost}
 */
function instance() {
    if (!singleton) singleton = new CommitWorkerHost(size_from_config());
    return singleton;
}

// EXPORTS
exports.CommitWorkerHost = CommitWorkerHost;
exports.instance = instance;
exports.fork_share_bytes = fork_share_bytes;
exports.derive_limits = derive_limits;
exports.size_from_config = size_from_config;
exports.rebuild_error = rebuild_error;
exports.PARSE_HEAP_FACTOR = PARSE_HEAP_FACTOR;
exports.HEAP_BASE_BYTES = HEAP_BASE_BYTES;
exports.COMMIT_CHARGE_FACTOR = COMMIT_CHARGE_FACTOR;
exports.MIN_PARSE_CAP_BYTES = MIN_PARSE_CAP_BYTES;
exports.INDEX_BYTES_PER_ELEMENT = INDEX_BYTES_PER_ELEMENT;
exports.MIN_CHARGE_BYTES = MIN_CHARGE_BYTES;
exports.MIN_OOM_THROTTLE_BYTES = MIN_OOM_THROTTLE_BYTES;
exports.WORKER_BASELINE_BYTES = WORKER_BASELINE_BYTES;
exports.MIN_BUFFER_BUDGET_BYTES = MIN_BUFFER_BUDGET_BYTES;
