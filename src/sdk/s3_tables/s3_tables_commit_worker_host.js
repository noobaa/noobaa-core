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
 * Everything here is sized from the slice of the pod this process may use. See
 * {@link derive_limits} for how, and `commit_worker.js`'s header for the measurements
 * the constants come from.
 */

const WORKER_PATH = path.join(__dirname, 's3_tables_commit_worker.js');

/**
 * Worker old-space per byte of input document, as an upper bound on what a transform
 * *needs*. Two documents of the same size do not cost the same: measured on the pinned
 * Node, 49.6 MB of fat snapshots needed 3.9x, and 50 MB of lean ones - more objects per
 * byte - needed 5.1x. 6 is the estimate the admission check uses.
 */
const HEAP_ADMIT_FACTOR = 6;
/**
 * And the heap is sized a third again above that, so a document the check admits runs
 * comfortably inside the limit rather than at its edge.
 *
 * **That margin is a safety property, not tuning.** `resourceLimits` does not reliably
 * contain a heap overrun: a parse that overruns a limit *close* to what it needs aborts
 * the whole process with `FATAL ERROR: Reached heap limit` instead of raising
 * `ERR_WORKER_OUT_OF_MEMORY`. Measured against a 50 MB document needing 256 MB: 128,
 * 160 and 192 MB all aborted the process, 224 MB failed cleanly, 256 MB succeeded. The
 * two factors keep dispatched work out of that band from both sides.
 */
const HEAP_SIZING_FACTOR = 8;
/** Below this a worker cannot comfortably start and run the engine at all. */
const MIN_HEAP_BYTES = 64 * 1024 * 1024;
/** Node rejects or misbehaves on an absurdly small old-space limit. */
const MIN_RESOURCE_LIMIT_MB = 16;
/**
 * What a worker costs *outside* old-space - V8 itself, new space, code, the loaded
 * engine. `maxOldGenerationSizeMb` does not cover it, so it is subtracted explicitly
 * rather than hidden inside a fudge factor on the heap limit.
 */
const WORKER_BASELINE_BYTES = 32 * 1024 * 1024;
/**
 * Admission never collapses to zero. Without a floor the budget subtraction goes
 * negative on a small pod and *every* commit is throttled, including the 10 KB ones
 * that are the common case - dead rather than degraded.
 */
const MIN_BUFFER_BUDGET_BYTES = 16 * 1024 * 1024;
/** So a flood of tiny commits cannot each charge ~0 and slip the bound. */
const MIN_CHARGE_BYTES = 64 * 1024;
/**
 * Under this size, memory pressure is not a credible explanation for a worker OOM, so
 * it is reported as a defect (TransientFailure) rather than as capacity (Throttled).
 */
const MIN_OOM_THROTTLE_BYTES = 1024 * 1024;
/**
 * V8 does not return a grown old-space to the OS, so a process that served one 50 MB
 * commit would hold a few hundred MB of idle worker for the life of the pod. Five
 * minutes is long enough that a steadily committing table never pays the ~17 ms
 * respawn, short enough that a one-off large commit gives its memory back.
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
 * has *already* been divided by `ENDPOINT_FORKS` (`config.js:28`). Dividing it again -
 * which is what §8.3's formula says literally - would halve twice whenever the variable
 * is unset. The operator sets it from `limits.memory` through the downward API, so the
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
 * Split this process's tables budget between the worker's heap ceiling and the bytes
 * admission may hold. Three things must fit at once, and each is counted exactly once:
 *
 * 1. the running transform's object graph - bounded by `heap_limit_bytes`, the line at
 *    which V8 kills the worker and only the worker;
 * 2. the worker's non-heap cost - `WORKER_BASELINE_BYTES`;
 * 3. document bytes held on the main thread for admitted but unfinished commits - the
 *    only free variable, and therefore what admission meters.
 *
 * Note what is *not* double-counted: an input buffer is transferred, so the main thread
 * and the worker never hold it simultaneously. It is charged once, to admission.
 *
 * Pure, for the same reason as above.
 *
 * @param {{ max_parse_bytes: number, budget_bytes: number }} p
 * @returns {{ heap_limit_bytes: number, buffer_budget_bytes: number, undersized: boolean }}
 */
function derive_limits({ max_parse_bytes, budget_bytes }) {
    // never aim below what V8 needs to load the engine and run at all, however small
    // the configured cap is
    const target = Math.max(max_parse_bytes * HEAP_SIZING_FACTOR, MIN_HEAP_BYTES);
    // the heap may not eat the whole budget - admission has to keep something
    const ceiling = budget_bytes - WORKER_BASELINE_BYTES - MIN_BUFFER_BUDGET_BYTES;
    // and on a budget too small even for that, start a worker that can at least run:
    // a worker that dies on startup makes the feature fail opaquely, where an
    // undersized one fails each oversized commit with an honest 429
    const heap_limit_bytes = Math.max(Math.min(target, ceiling), MIN_RESOURCE_LIMIT_MB * 1024 * 1024);
    const buffer_budget_bytes = Math.max(
        budget_bytes - heap_limit_bytes - WORKER_BASELINE_BYTES,
        MIN_BUFFER_BUDGET_BYTES);
    return {
        heap_limit_bytes,
        buffer_budget_bytes,
        // a commit at the configured cap cannot fit this deployment's worker heap
        undersized: heap_limit_bytes < max_parse_bytes * HEAP_ADMIT_FACTOR,
    };
}

/**
 * The only place that reads `config`.
 * @returns {{ max_parse_bytes: number, budget_bytes: number }}
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
        budget_bytes: Math.floor(share * config.S3_TABLES_MEM_FRACTION),
    };
}

// ///////////////////////////////////////////////////////////////////////////////////
// errors across the thread boundary
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * Rebuild what `commit_worker.serialize_error()` flattened. A semantic error comes back
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
// admission
// ///////////////////////////////////////////////////////////////////////////////////

/**
 * A reservation of main-thread bytes, held from before the request body is buffered
 * until the commit is done with its buffers (§8.3).
 */
class AdmissionSlot {

    /**
     * @param {CommitWorkerHost} engine
     * @param {number} charged
     */
    constructor(engine, charged) {
        this._engine = engine;
        this.charged = charged;
        this.released = false;
    }

    /**
     * Raise the reservation once the real sizes are known - the metadata size is not
     * knowable when the request body arrives, only after the pointer read and the fetch.
     *
     * **Non-blocking on purpose.** Waiting here deadlocks: every slot can be held by a
     * request waiting to top up, with nothing in flight able to finish and release.
     * Failing with Throttled instead frees the bytes immediately.
     *
     * @param {number} total_bytes the full `metadata_bytes + commit_bytes`
     */
    top_up(total_bytes) {
        if (this.released) throw new TypeError('admission slot already released');
        const want = Math.max(Math.ceil(total_bytes), MIN_CHARGE_BYTES);
        const extra = want - this.charged;
        if (extra <= 0) return;
        if (want > this._engine.buffer_budget_bytes) {
            throw errors.throttled(
                `a commit of ${want} bytes exceeds this endpoint's entire commit buffer budget ` +
                `of ${this._engine.buffer_budget_bytes} bytes`);
        }
        if (!this._engine._sem.try_acquire_nonblocking(extra)) {
            throw errors.throttled('the endpoint is already holding its limit of in-flight commit bytes');
        }
        this.charged = want;
    }

    /** Idempotent, so a `finally` on an already-failed path is safe. */
    release() {
        if (this.released) return;
        this.released = true;
        this._engine._sem.release(this.charged);
    }
}

// ///////////////////////////////////////////////////////////////////////////////////
// the engine
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
     *      heap_limit_bytes?: number,
     *      buffer_budget_bytes?: number,
     *      max_workers?: number,
     *      idle_timeout_ms?: number,
     * }} params `heap_limit_bytes` and `buffer_budget_bytes` override the derivation;
     *      they exist so tests can build an engine with limits small enough to exhaust.
     */
    constructor(params) {
        const { max_parse_bytes, budget_bytes } = params;
        const derived = derive_limits({ max_parse_bytes, budget_bytes });
        this.max_parse_bytes = max_parse_bytes;
        this.budget_bytes = budget_bytes;
        this.heap_limit_bytes = params.heap_limit_bytes ?? derived.heap_limit_bytes;
        this.buffer_budget_bytes = params.buffer_budget_bytes ?? derived.buffer_budget_bytes;
        // One worker, by choice rather than by necessity (§8.3). Each worker needs a heap
        // ceiling sized for a worst-case document, so a second one buys parallelism by
        // squeezing admission; and the endpoint is main-thread bound, so on the default
        // profile's CPU limit the headroom above a saturated main thread is about one
        // core. The dispatch path below is written against a set of workers so that
        // raising this is picking an idle worker instead of the worker.
        this.max_workers = params.max_workers ?? 1;
        this.idle_timeout_ms = params.idle_timeout_ms ?? IDLE_TIMEOUT_MS;

        this._sem = new Semaphore(this.buffer_budget_bytes);
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
            max_workers: this.max_workers,
        });
        if (derived.undersized) {
            dbg.warn('CommitWorkerHost: this deployment cannot transform a metadata document at the ' +
                `configured cap. Heap limit ${Math.round(this.heap_limit_bytes / 1048576)} MB, but a ` +
                `${Math.round(max_parse_bytes / 1048576)} MB document needs about ` +
                `${Math.round(max_parse_bytes * HEAP_ADMIT_FACTOR / 1048576)} MB. Commits of larger ` +
                'documents will be rejected as Throttled. Raise the endpoint memory limit or ' +
                'config.S3_TABLES_MEM_FRACTION.');
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
     * Reserve main-thread bytes before the request body is buffered (§8.3).
     *
     * This does **not** limit transform concurrency - the worker is serial anyway. It
     * bounds *arrivals*: every commit in flight holds its fetched `metadata.json` and
     * its request body on the main thread while it waits for the worker, and a serial
     * consumer with unbounded arrivals is a queue made of 50 MB buffers.
     *
     * @param {number} estimated_bytes what is known at this point - usually the request
     *      body's Content-Length; {@link AdmissionSlot#top_up} corrects it later.
     * @returns {Promise<AdmissionSlot>}
     */
    async acquire(estimated_bytes) {
        const cost = Math.max(Math.ceil(estimated_bytes) || 0, MIN_CHARGE_BYTES);
        if (cost > this.buffer_budget_bytes) {
            // the semaphore could never satisfy it, so waiting would hang forever
            throw errors.throttled(
                `a commit of ${cost} bytes exceeds this endpoint's entire commit buffer budget ` +
                `of ${this.buffer_budget_bytes} bytes`);
        }
        // The bounded queue. Checked synchronously with the wait() below, so on a
        // single-threaded event loop nothing can slip in between.
        if (this._sem.value < cost && this._sem.waiting_value >= this.buffer_budget_bytes) {
            throw errors.throttled('too many commits are already waiting for commit buffer capacity');
        }
        await this._sem.wait(cost);
        return new AdmissionSlot(this, cost);
    }

    // ----- the transform ---------------------------------------------------------

    /**
     * Run one transform in a worker.
     *
     * @param {{
     *      metadata_bytes: Buffer|Uint8Array|string,
     *      commit_bytes: Buffer|Uint8Array|string,
     *      ctx: object,
     *      slot: AdmissionSlot,
     * }} params the slot is required rather than taken here, so admission cannot be
     *      skipped by a caller that forgets - §8.3 puts it before the body is buffered,
     *      which is long before this call.
     * @returns {Promise<{ next_bytes: Buffer, header: object }>}
     */
    transform({ metadata_bytes, commit_bytes, ctx, slot }) {
        if (!(slot instanceof AdmissionSlot)) {
            throw new TypeError('transform requires an admission slot from acquire()');
        }
        if (this._stopped) return Promise.reject(errors.transient_failure('the metadata engine is shutting down'));
        const bytes = byte_length(metadata_bytes) + byte_length(commit_bytes);
        this._assert_fits(bytes);
        this._seq += 1;
        const id = this._seq;
        return new Promise((resolve, reject) => {
            this._queue.push({ id, metadata_bytes, commit_bytes, ctx, bytes, resolve, reject });
            this._pump();
        });
    }

    /**
     * Refuse a transform this process cannot run, **before** a worker is asked to try.
     *
     * `resourceLimits` is not the containment guarantee §8.3 assumes. Measured on the
     * pinned Node: a 50 MB document parsed in a worker capped at 128 MB raises a clean
     * `ERR_WORKER_OUT_OF_MEMORY`, but the same document at 160 MB and at 192 MB -
     * limits *near* what the parse actually needs - aborts the **whole process** with
     * `FATAL ERROR: Reached heap limit` instead. V8 cannot always unwind an allocation
     * failure raised inside a long synchronous C++ builtin, and `JSON.parse` of a 50 MB
     * string is exactly that. The containment is reliable with plenty of headroom and
     * reliable with far too little; the band around the requirement is where it aborts.
     *
     * So the worker must never be sent work that lands in that band. The test is the
     * same `HEAP_ADMIT_FACTOR` the heap limit is derived from, one notch below the
     * `HEAP_SIZING_FACTOR` the limit itself uses: on a pod whose budget granted the
     * full sizing factor, the check
     * can only fire for a document over the configured cap, which the engine rejects
     * anyway. It fires in earnest only where the budget forced a smaller heap - and
     * there it converts a dead endpoint fork into an honest 429.
     *
     * Stateless: a size compared against a constant, never a threshold learned from a
     * previous failure. A learned floor could only ratchet downwards, since the
     * documents that would disprove it are the ones it refuses.
     *
     * @param {number} bytes
     */
    _assert_fits(bytes) {
        const needed = bytes * HEAP_ADMIT_FACTOR;
        if (needed <= this.heap_limit_bytes) return;
        dbg.warn('CommitWorkerHost: refusing a transform that does not fit the worker heap', {
            document_bytes: bytes,
            needed_bytes: needed,
            heap_limit_bytes: this.heap_limit_bytes,
        });
        throw errors.throttled(
            `this endpoint cannot transform a ${bytes} byte metadata document: it needs about ` +
            `${needed} bytes of worker heap and the limit is ${this.heap_limit_bytes} bytes`);
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
            slot.worker.postMessage(
                { id: entry.id, metadata_bytes: md, commit_bytes: cb, ctx: entry.ctx },
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
            resourceLimits: {
                maxOldGenerationSizeMb: Math.max(
                    Math.ceil(this.heap_limit_bytes / 1048576), MIN_RESOURCE_LIMIT_MB),
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
     * Heap exhaustion is capacity, so it is Throttled (429) - "this endpoint could not
     * hold a document this large" - rather than TransientFailure (409), which tells the
     * client to reload and retry a commit that can never succeed here. Nothing is
     * remembered between attempts: a learned size floor would only ever ratchet down,
     * since the documents that would disprove it are exactly the ones it rejects.
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
 * The process's engine, built on first use. Lazy because a pod that never serves a
 * commit should never size, spawn or log anything.
 * @returns {CommitWorkerHost}
 */
function instance() {
    if (!singleton) singleton = new CommitWorkerHost(size_from_config());
    return singleton;
}

// EXPORTS
exports.CommitWorkerHost = CommitWorkerHost;
exports.AdmissionSlot = AdmissionSlot;
exports.instance = instance;
exports.fork_share_bytes = fork_share_bytes;
exports.derive_limits = derive_limits;
exports.size_from_config = size_from_config;
exports.rebuild_error = rebuild_error;
exports.HEAP_ADMIT_FACTOR = HEAP_ADMIT_FACTOR;
exports.HEAP_SIZING_FACTOR = HEAP_SIZING_FACTOR;
exports.MIN_CHARGE_BYTES = MIN_CHARGE_BYTES;
exports.MIN_OOM_THROTTLE_BYTES = MIN_OOM_THROTTLE_BYTES;
exports.WORKER_BASELINE_BYTES = WORKER_BASELINE_BYTES;
exports.MIN_BUFFER_BUDGET_BYTES = MIN_BUFFER_BUDGET_BYTES;
exports.MIN_HEAP_BYTES = MIN_HEAP_BYTES;
