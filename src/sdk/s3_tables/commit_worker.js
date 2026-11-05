/* Copyright (C) 2026 NooBaa */
'use strict';

const { parentPort } = require('node:worker_threads');
const commit_engine = require('./commit_engine');
const { S3TablesError } = require('./s3_tables_errors');
const { detachable } = require('./transfer_utils');

/**
 * The worker entry point for the metadata transform (design §8.3).
 *
 * This file runs on a worker thread and is a message pump, nothing more: bytes in,
 * `commit_engine.transform()`, bytes out. The whole transform lives in the engine, so
 * the story's "worker output is identical to running the engine directly" criterion is
 * true by construction rather than by test.
 *
 * It requires `commit_engine`, `s3_tables_errors` and `transfer_utils` and **nothing
 * else - in particular never `config.js`**, whose load has side effects of its own
 * (§8.1). Every limit the transform needs arrives inside `ctx`, read from config on the
 * main thread. That constraint is what makes running here possible at all: a worker has
 * none of the main thread's database handles or sockets.
 *
 * ## Why this parses the whole document, and what that costs
 *
 * `transform()` parses the input into a JavaScript object graph, mutates it in place and
 * serializes it back (§8.1 - "the parse is the clone"). Measured on a 49.6 MB document
 * of 130,000 snapshots with out-of-range ids, which is the worst case the 50 MB cap
 * allows:
 *
 * - it needs **~4x the document in old-space** (49.6 MB survived a 192 MB heap limit and
 *   died at 160 MB; 22.9 MB survived 96 MB and died at 64 MB), which is where
 *   `engine.js`'s `HEAP_FACTOR` comes from;
 * - one transform takes **~1 s** (935 ms parse, 103 ms serialize). The lossless reviver
 *   dominates: a plain `JSON.parse` of the same bytes is ~115 ms, so preserving
 *   out-of-range integers costs roughly 7x the parse.
 *
 * **If a fork is using more memory than expected, or commits at the tail are slow, those
 * two numbers are the reason, and streaming is the lever.** About 95 % of a large
 * document is the `snapshots` array, and a commit only appends to it or filters it - the
 * shape where a byte-level splice works. Streaming the transform instead of parsing it
 * would cut memory from ~4x to ~2x the document and the transform from ~1 s to roughly
 * 200 ms, because copied bytes need no reviver at all. It is not done here because it
 * costs a hand-rolled incremental JSON tokenizer (there is no streaming-JSON dependency
 * in this repo), two passes over the input - requirements must be checked before any
 * output byte is emitted, and the fields they read can appear after `snapshots` - and a
 * rework of the engine's parsed-document API. Also ruled out: keeping the big array as
 * raw text via the parse reviver, because `JSON.parse` exposes `context.source` only for
 * primitives, never for an object or array.
 */

/**
 * Flatten an error for `postMessage`.
 *
 * **Structured clone keeps only `name`, `message`, `stack` and `cause` on an Error.**
 * Custom own properties are dropped, so posting an `S3TablesError` as-is would deliver
 * it to the main thread with `code` and `details` silently gone, and every semantic
 * error would arrive indistinguishable from every other. They are flattened by hand
 * here and rebuilt in `engine.js`.
 *
 * @param {any} err
 * @returns {{ s3_tables_code?: string, message: string, details?: object, name: string, stack?: string }}
 */
function serialize_error(err) {
    return {
        s3_tables_code: err instanceof S3TablesError ? err.code : undefined,
        message: (err && err.message) || String(err),
        details: err && err.details,
        name: (err && err.name) || 'Error',
        stack: err && err.stack,
    };
}

/**
 * @param {{ id: number, metadata_bytes: Uint8Array, commit_bytes: Uint8Array, ctx: object }} msg
 */
function on_message(msg) {
    const { id, metadata_bytes, commit_bytes, ctx } = msg;
    try {
        // transform() accepts Buffer | Uint8Array | string and honours byteOffset, so the
        // transferred views go straight in - no rewrap, no copy.
        const { next_bytes, header } = commit_engine.transform({ metadata_bytes, commit_bytes, ctx });
        // next_bytes comes from Buffer.from(string): under 4 KiB that is a view into this
        // thread's shared pool, and transferring it would detach the pool here exactly as
        // it would on the main thread.
        const out = detachable(next_bytes);
        parentPort.postMessage({ id, ok: true, next_bytes: out, header }, [out.buffer]);
    } catch (err) {
        parentPort.postMessage({ id, ok: false, error: serialize_error(err) });
    }
}

// Guarded so that requiring this module on the main thread - a mistake, but a cheap one
// to make - does nothing instead of throwing on a null parentPort.
if (parentPort) parentPort.on('message', on_message);

// EXPORTS - for unit tests; the worker itself needs none of them.
exports.serialize_error = serialize_error;
exports.on_message = on_message;
