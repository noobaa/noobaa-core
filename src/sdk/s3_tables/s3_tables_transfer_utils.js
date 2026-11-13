/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * Buffer handling for the worker boundary (design §8.3).
 *
 * Shared by both sides of the boundary - `s3_tables_commit_worker_host.js` on the main thread and
 * `s3_tables_commit_worker.js` inside the worker - which is why it is its own module rather than
 * a private helper in either. It requires nothing, so the worker side stays free of
 * `config.js` and of anything with side effects (§8.1).
 */

/**
 * Make a byte view safe to hand to `postMessage`'s transfer list.
 *
 * **The hazard this exists for.** Node allocates every Buffer under 4 KiB
 * (`Buffer.poolSize >>> 1`) out of a shared 8 KiB pool, so a small Buffer is a *view*
 * into memory that unrelated Buffers also live in. Transferring `buf.buffer` detaches
 * that whole pool, and every other Buffer sharing it silently becomes a zero-length
 * view - corruption with no error, in code that never touched the worker. A commit
 * request body is routinely under 4 KiB, so this is the common case, not the edge one.
 *
 * A view that already owns its entire ArrayBuffer - which is what a 50 MB document
 * concatenated from a stream looks like - is returned untouched, so the large transfers
 * this boundary exists for stay copy-free. Only the small, pooled case pays a copy, and
 * there the copy is a few kilobytes.
 *
 * @param {Buffer|Uint8Array|string} bytes
 * @returns {Uint8Array} a view owning the whole of its own ArrayBuffer
 */
function detachable(bytes) {
    const view = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
    if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) return view;
    // ArrayBuffer.prototype.slice copies into a fresh, exactly sized ArrayBuffer. Going
    // through Buffer.from() instead would re-pool a small result and reintroduce the bug.
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

/**
 * The byte length of whatever the caller passed, without materializing a copy.
 * @param {Buffer|Uint8Array|string} bytes
 * @returns {number}
 */
function byte_length(bytes) {
    if (typeof bytes === 'string') return Buffer.byteLength(bytes);
    return bytes.byteLength;
}

// EXPORTS
exports.detachable = detachable;
exports.byte_length = byte_length;
