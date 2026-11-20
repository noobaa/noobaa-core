/* Copyright (C) 2026 NooBaa */
'use strict';

const { parentPort } = require('node:worker_threads');
const commit_engine = require('./s3_tables_commit_engine');
const { S3TablesError } = require('./s3_tables_errors');
const { detachable } = require('./s3_tables_transfer_utils');

/**
 * The worker entry point for the metadata transform (design §8.3).
 *
 * This file runs on a worker thread and is a message pump, nothing more: bytes in,
 * `commit_engine.transform()`, bytes out. The whole transform lives in the engine, so
 * the story's "worker output is identical to running the engine directly" criterion is
 * true by construction rather than by test.
 *
 * It requires `s3_tables_commit_engine`, `s3_tables_errors` and `s3_tables_transfer_utils` and **nothing
 * else - in particular never `config.js`**, whose load has side effects of its own
 * (§8.1). Every limit the transform needs arrives inside `ctx`, read from config on the
 * main thread. That constraint is what makes running here possible at all: a worker has
 * none of the main thread's database handles or sockets.
 *
 * ## What a transform costs
 *
 * `transform()` never parses the stored document whole (§8.1). It indexes the bytes,
 * keeps the arrays that grow with a table's history as byte ranges, parses a field only
 * when an update reads it, and writes the output by copying every range nothing
 * touched. Two consequences shape everything around this file:
 *
 * - **The heap this thread needs does not depend on the document.** It is bounded by
 *   the parse caps in `ctx`, which is why the host can start the worker with a fixed
 *   heap limit and never has to judge whether a document "fits".
 * - **No single native call can fill that heap.** A whole-document `JSON.parse` could,
 *   and when it did V8 aborted the process rather than this thread. The largest parse
 *   left is one capped request body or one capped field.
 *
 * Measured on a prototype against 50 MB of snapshots: an append needed 6 MB of
 * old-space and ~0.25 s, where a whole-document parse needed 288 MB and ~1.2 s.
 */

/**
 * Flatten an error for `postMessage`.
 *
 * **Structured clone keeps only `name`, `message`, `stack` and `cause` on an Error.**
 * Custom own properties are dropped, so posting an `S3TablesError` as-is would deliver
 * it to the main thread with `code` and `details` silently gone, and every semantic
 * error would arrive indistinguishable from every other. They are flattened by hand
 * here and rebuilt in `s3_tables_commit_worker_host.js`.
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
