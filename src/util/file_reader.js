/* Copyright (C) 2024 NooBaa */
'use strict';

const stream = require('stream');
const assert = require('assert');
const config = require('../../config');
const nb_native = require('./nb_native');
const stream_utils = require('./stream_utils');
const native_fs_utils = require('./native_fs_utils');

/** @typedef {import('./buffer_utils').MultiSizeBuffersPool} MultiSizeBuffersPool */

/**
 * FileReader is a Readable stream that reads data from a filesystem file.
 * 
 * The Readable interface is easy to use, however, for us, it is not efficient enough 
 * because it has to allocate a new buffer for each chunk of data read from the file.
 * This allocation and delayed garbage collection becomes expensive in high throughputs
 * (which is something to improve in nodejs itself).
 * 
 * To solve this, we added the optimized method read_into_stream(target_stream) which uses 
 * a buffer pool to recycle the buffers and avoid the allocation overhead.
 * 
 * The target_stream should be a Writable stream that will not use the buffer after the 
 * write callback, since we will release the buffer back to the pool in the callback.
 */
class FileReader extends stream.Readable {

    /**
     * @param {{
     *      fs_context: nb.NativeFSContext,
     *      file: nb.NativeFile,
     *      file_path: string,
     *      stat: nb.NativeFSStats,
     *      start: number,
     *      end: number,
     *      multi_buffer_pool: MultiSizeBuffersPool,
     *      signal: AbortSignal,
     *      stats?: import('../sdk/endpoint_stats_collector').EndpointStatsCollector,
     *      bucket?: string,
     *      namespace_resource_id?: string,
     *      highWaterMark?: number,
     * }} params
     */
    constructor({ fs_context,
        file,
        file_path,
        start,
        end,
        stat,
        multi_buffer_pool,
        signal,
        stats,
        bucket,
        namespace_resource_id,
        highWaterMark = config.NSFS_DOWNLOAD_STREAM_MEM_THRESHOLD,
    }) {
        super({ highWaterMark });
        this.fs_context = fs_context;
        this.file = file;
        this.file_path = file_path;
        this.stat = stat;
        this.start = Math.max(Math.min(Number(start) || 0, stat.size), 0);
        this.end = Math.max(Math.min(Number(end ?? Infinity), stat.size), this.start);
        assert(Number.isSafeInteger(this.start) && Number.isSafeInteger(this.end) &&
            this.start >= 0 && this.start <= this.end && this.end <= stat.size,
            `Invalid FileReader range ${this.start}-${this.end} for file of size ${stat.size}`);
        this.pos = this.start;
        this.multi_buffer_pool = multi_buffer_pool;
        this.signal = signal;
        this.stats = stats;
        this.stats_count_once = 1;
        this.bucket = bucket;
        this.namespace_resource_id = namespace_resource_id;
        this.num_bytes = 0;
        this.num_buffers = 0;
        this.log2_size_histogram = {};
    }

    /**
     * Readable stream implementation
     * @param {number} [size] 
     */
    async _read(size) {
        try {
            size ||= this.readableHighWaterMark;
            const remain_size = this.end - this.pos;
            if (remain_size <= 0) {
                this.push(null);
                return;
            }
            const read_size = Math.min(size, remain_size);
            const buffer = Buffer.allocUnsafe(read_size);
            const nread = await this.read_into_buffer(buffer, 0, read_size);
            if (nread === read_size) {
                this.push(buffer);
            } else if (nread > 0) {
                this.push(buffer.subarray(0, nread));
            } else {
                this.push(null);
            }
        } catch (err) {
            this.destroy(err);
        }
    }

    /**
     * @param {Buffer} buf
     * @param {number} offset
     * @param {number} length
     * @returns {Promise<number>}
     */
    async read_into_buffer(buf, offset, length) {
        await this._warmup_sparse_file(this.pos);
        this.signal.throwIfAborted();
        const nread = await this.file.read(this.fs_context, buf, offset, length, this.pos);
        if (nread) {
            this.pos += nread;
            this._update_stats(nread);
        }
        return nread;
    }


    /**
     * Alternative implementation without using Readable stream API
     * This allows to use a buffer pool to avoid creating new buffers.
     * 
     * The target_stream should be a Writable stream that will not use the buffer after the
     * write callback, since we will release the buffer back to the pool in the callback.
     * This means Transforms should not be used as target_stream.
     * 
     * @param {stream.Writable} target_stream 
    */
    async read_into_stream(target_stream) {
        if (target_stream instanceof stream.Transform) {
            throw new Error('FileReader read_into_stream must be called with a Writable stream, not a Transform stream');
        }
        // cheap fast-fail if target_stream is destroyed to stop earlier
        if (target_stream.destroyed) this.signal.throwIfAborted();

        let buffer_pool_cleanup = null;
        let drain_promise = null;

        try {
            while (this.pos < this.end) {
                // prefer to warmup sparse file before allocating a buffer
                await this._warmup_sparse_file(this.pos);

                // allocate or reuse buffer
                // TODO buffers_pool and the underlying semaphore should support abort signal
                // to avoid sleeping inside the semaphore until the timeout while the request is already aborted.
                this.signal.throwIfAborted();
                const remain_size = this.end - this.pos;
                const { buffer, callback } = await this.multi_buffer_pool.get_buffers_pool(remain_size).get_buffer();
                buffer_pool_cleanup = callback; // must be called ***IMMEDIATELY*** after get_buffer
                this.signal.throwIfAborted();

                // read from file
                const read_size = Math.min(buffer.length, remain_size);
                const nread = await this.read_into_buffer(buffer, 0, read_size);
                if (!nread) {
                    buffer_pool_cleanup = null;
                    callback();
                    break;
                }

                // wait for response buffer to drain before adding more data if needed -
                // this occurs when the output network is slower than the input file
                if (drain_promise) {
                    this.signal.throwIfAborted();
                    await drain_promise;
                    drain_promise = null;
                    this.signal.throwIfAborted();
                }

                // write the data out to response
                const data = buffer.subarray(0, nread);
                const write_ok = target_stream.write(data, null, callback);
                buffer_pool_cleanup = null; // cleanup is now in the socket responsibility
                if (!write_ok) {
                    drain_promise = stream_utils.wait_drain(target_stream, { signal: this.signal });
                    drain_promise.catch(() => undefined); // this avoids UnhandledPromiseRejection
                }
            }

            // wait for the last drain if pending.
            if (drain_promise) {
                this.signal.throwIfAborted();
                await drain_promise;
                drain_promise = null;
                this.signal.throwIfAborted();
            }

        } finally {
            if (buffer_pool_cleanup) buffer_pool_cleanup();
        }
    }

    /**
     * @param {number} size 
     */
    _update_stats(size) {
        this.num_bytes += size;
        this.num_buffers += 1;
        const log2_size = Math.ceil(Math.log2(size));
        this.log2_size_histogram[log2_size] = (this.log2_size_histogram[log2_size] || 0) + 1;

        // update stats collector but count the entire read operation just once
        const count = this.stats_count_once;
        this.stats_count_once = 0; // counting the entire operation just once
        this.stats?.update_nsfs_read_stats({
            namespace_resource_id: this.namespace_resource_id,
            size,
            count,
            bucket_name: this.bucket,
        });
    }

    /**
     * @param {number} pos
     */
    async _warmup_sparse_file(pos) {
        if (!config.NSFS_BUF_WARMUP_SPARSE_FILE_READS) return;
        if (!native_fs_utils.is_sparse_file(this.stat)) return;
        this.signal.throwIfAborted();
        await native_fs_utils.warmup_sparse_file(this.fs_context, this.file, this.file_path, this.stat, pos);
    }


}



class NewlineReaderFilePathEntry {
    constructor(fs_context, filepath) {
        this.fs_context = fs_context;
        this.path = filepath;
    }

    async open(mode = 'rw*') {
        return nb_native().fs.open(this.fs_context, this.path, mode);
    }
}

class NewlineReader {
    /**
     * Newline character code
     */
    static NL_CODE = 10;

    /**
     * NewlineReader allows to read a file line by line.
     * @param {nb.NativeFSContext} fs_context 
     * @param {string} filepath 
     * @param {{
     *  lock?: 'EXCLUSIVE' | 'SHARED'
     *  bufsize?: number;
     *  skip_leftover_line?: boolean;
     *  skip_overflow_lines?: boolean;
     *  read_file_offset?: number;
     * }} [cfg]
     **/
    constructor(fs_context, filepath, cfg) {
        this.path = filepath;
        this.lock = cfg?.lock;
        this.skip_leftover_line = Boolean(cfg?.skip_leftover_line);
        this.skip_overflow_lines = Boolean(cfg?.skip_overflow_lines);

        this.fs_context = fs_context;
        this.fh = null;
        this.eof = false;
        this.read_file_offset = cfg?.read_file_offset || 0;

        this.buf = Buffer.alloc(cfg?.bufsize || 64 * 1024);
        this.start = 0;
        this.end = 0;
        this.overflow_state = false;
        this.next_line_file_offset = cfg?.read_file_offset || 0;
    }

    info() {
        return {
            path: this.path,
            read_offset: this.read_file_offset,
            overflow_state: this.overflow_state,
            start: this.start,
            end: this.end,
            eof: this.eof,
        };
    }

    /**
     * nextline returns the next line from the given file
     * @returns {Promise<string | null>}
     */
    async nextline() {
        if (!this.fh) await this.init();

        // TODO - in case more data will be appended to the file - after each read the reader must set reader.eof = false if someone will keep on reading from a file while it is being written.
        while (!this.eof) {
            // extract next line if terminated in current buffer
            if (this.start < this.end) {
                const term_idx = this.buf.subarray(this.start, this.end).indexOf(NewlineReader.NL_CODE);
                if (term_idx >= 0) {
                    if (this.overflow_state) {
                        console.warn('line too long finally terminated:', this.info());
                        this.overflow_state = false;
                        this.start += term_idx + 1;
                        continue;
                    }
                    const line = this.buf.toString('utf8', this.start, this.start + term_idx);
                    this.start += term_idx + 1;
                    this.next_line_file_offset = this.read_file_offset - (this.end - this.start);
                    return line;
                }
            }

            // relocate existing data to offset 0 in buf
            if (this.start > 0) {
                const n = this.buf.copy(this.buf, 0, this.start, this.end);
                this.start = 0;
                this.end = n;
            }

            // check limits
            if (this.buf.length <= this.end) {
                if (!this.skip_overflow_lines) {
                    throw new Error("line too long or non terminated");
                }

                console.warn('line too long or non terminated:', this.info());
                this.end = 0;
                this.start = 0;
                this.overflow_state = true;
            }

            // read from file
            const avail = this.buf.length - this.end;
            const read = await this.fh.read(this.fs_context, this.buf, this.end, avail, this.read_file_offset);
            if (!read) {
                this.eof = true;

                // what to do with the leftover in the buffer on eof
                if (this.end > this.start) {
                    if (this.skip_leftover_line) {
                        console.warn("leftover at eof:", this.info());
                    } else if (this.overflow_state) {
                        console.warn('line too long finally terminated at eof:', this.info());
                    } else {
                        const line = this.buf.toString('utf8', this.start, this.end);
                        this.start = this.end;
                        this.next_line_file_offset = this.read_file_offset;
                        return line;
                    }
                }

                return null;
            }
            this.read_file_offset += read;
            this.end += read;
        }

        return null;
    }

    /**
     * forEach takes a callback function and invokes it
     * with each line as parameter
     * 
     * The callback function can return `false` if it wants
     * to stop the iteration.
     * @param {(entry: string) => Promise<boolean>} cb 
     * @returns {Promise<[number, boolean]>}
     */
    async forEach(cb) {
        let entry = await this.nextline();
        let count = 0;
        while (entry !== null) {
            count += 1;
            if ((await cb(entry)) === false) return [count, false];

            entry = await this.nextline();
        }

        return [count, true];
    }

    /**
     * forEachFilePathEntry is a wrapper around `forEach` where each entry in
     * log file is assumed to be a file path and the given callback function
     * is invoked with that entry wrapped in a class with some convenient wrappers.
     * @param {(entry: NewlineReaderFilePathEntry) => Promise<boolean>} cb 
     * @returns {Promise<[number, boolean]>}
     */
    async forEachFilePathEntry(cb) {
        return this.forEach(entry => cb(new NewlineReaderFilePathEntry(this.fs_context, entry)));
    }

    // reset will reset the reader and will allow reading the file from
    // the beginning again, this does not reopens the file so if the file
    // was moved, this will still keep on reading from the previous FD.
    reset() {
        this.eof = false;
        this.read_file_offset = 0;
        this.start = 0;
        this.end = 0;
        this.overflow_state = false;
    }

    async init() {
        let fh = null;
        try {
            // here we are opening the file with both read and write to make sure
            // fcntlock can acquire both `EXCLUSIVE` as well as `SHARED` lock based
            // on the need.
            // If incompatible file descriptor and lock types are used then fcntl
            // throws `EBADF`.
            fh = await nb_native().fs.open(this.fs_context, this.path, '+');
            if (this.lock) await fh.fcntllock(this.fs_context, this.lock);

            this.fh = fh;
        } catch (error) {
            if (fh) await fh.close(this.fs_context);

            throw error;
        }
    }

    /**
     * close will close the file descriptor and will
     * set the internaly file handler to `null`. HOWEVER,
     * the reader can still be used after close is called
     * as the reader will initiialize the file handler
     * again if a read is attempted.
     */
    async close() {
        const fh = this.fh;
        this.fh = null;

        if (fh) await fh.close(this.fs_context);
    }
}

exports.NewlineReader = NewlineReader;
exports.NewlineReaderEntry = NewlineReaderFilePathEntry;
exports.FileReader = FileReader;
