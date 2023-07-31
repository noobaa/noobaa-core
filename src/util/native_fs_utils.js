/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const P = require('../util/promise');

/** @typedef {import('../util/buffer_utils').BuffersPool} BuffersPool */

/**
 * @param {BuffersPool} buffers_pool 
 * @param {nb.NativeFSContext} fs_context 
 * @param {nb.NativeFile} src_file
 * @param {nb.NativeFile} dst_file 
 * @param {number} size 
 * @param {number} write_offset 
 * @param {number} read_offset 
 */
async function copy_bytes(buffers_pool, fs_context, src_file, dst_file, size, write_offset, read_offset) {
    dbg.log1(`Native_fs_utils.copy_bytes size=${size} read_offset=${read_offset} write_offset=${write_offset}`);
    let buffer_pool_cleanup = null;
    try {
        let read_pos = Number(read_offset || 0);
        let bytes_written = 0;
        const total_bytes_to_write = Number(size);
        let write_pos = write_offset >= 0 ? write_offset : 0;
        for (;;) {
            const total_bytes_left = total_bytes_to_write - bytes_written;
            if (total_bytes_left <= 0) break;
            const { buffer, callback } = await buffers_pool.get_buffer();
            buffer_pool_cleanup = callback;
            const bytesRead = await src_file.read(fs_context, buffer, 0, buffer.length, read_pos);
            if (!bytesRead) {
                buffer_pool_cleanup = null;
                callback();
                break;
            }
            read_pos += bytesRead;

            let data = buffer.slice(0, bytesRead);
            if (total_bytes_left < bytesRead) data = data.slice(0, total_bytes_left);
            await dst_file.write(fs_context, data, undefined, write_pos);
            write_pos += data.byteLength;
            bytes_written += data.byteLength;
            // Returns the buffer to pool to avoid starvation
            buffer_pool_cleanup = null;
            callback();
        }
    } catch (err) {
        dbg.error('Native_fs_utils.copy_bytes: error - ', err);
        throw err;
    } finally {
        try {
            // release buffer back to pool if needed
            if (buffer_pool_cleanup) buffer_pool_cleanup();
        } catch (err) {
            dbg.warn('Native_fs_utils.copy_bytes file close error', err);
        }
    }
}



/**
 * @param {nb.NativeFSContext} fs_context 
 * @param {nb.NativeFile[]} list_of_files
 */
async function finally_close_files(fs_context, list_of_files = []) {
    await P.map_with_concurrency(5, list_of_files, async file => {
        try {
            if (file) await file.close(fs_context);
        } catch (err) {
            dbg.warn('Native_fs_utils.finally_close_files file close error', err);
        }
    });
}

exports.copy_bytes = copy_bytes;
exports.finally_close_files = finally_close_files;
