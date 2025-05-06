/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');
const config = require('../../config');
const nb_native = require('./nb_native');
const dbg = require('./debug_module')(__filename);

/**
 * FileWriter is a Writable stream that write data to a filesystem file,
 * with optional calculation of md5 for etag.
 */
class FileWriter extends stream.Writable {

    /**
     * @param {{
     *      target_file: nb.NativeFile,
     *      fs_context: nb.NativeFSContext,
     *      md5_enabled?: boolean,
     *      offset?: number,
     *      stats?: import('../sdk/endpoint_stats_collector').EndpointStatsCollector,
     *      bucket?: string,
     *      namespace_resource_id?: string,
     * }} params
     */
    constructor({ target_file, fs_context, md5_enabled, offset, stats, bucket, namespace_resource_id }) {
        super({ highWaterMark: config.NFSF_UPLOAD_STREAM_MEM_THRESHOLD });
        this.target_file = target_file;
        this.fs_context = fs_context;
        this.offset = offset;
        this.total_bytes = 0;
        this.count_once = 1;
        this.stats = stats;
        this.bucket = bucket;
        this.namespace_resource_id = namespace_resource_id;
        this.MD5Async = md5_enabled ? new (nb_native().crypto.MD5Async)() : undefined;
        const platform_iov_max = nb_native().fs.PLATFORM_IOV_MAX;
        this.iov_max = platform_iov_max ? Math.min(platform_iov_max, config.NSFS_DEFAULT_IOV_MAX) : config.NSFS_DEFAULT_IOV_MAX;
    }

    /**
     * @param {stream.Readable} source_stream 
     * @param {import('events').Abortable} [options]
     */
    async write_entire_stream(source_stream, options) {
        await stream.promises.pipeline(source_stream, this, options);
        await stream.promises.finished(this, options);
    }

    /**
     * Ingests an array of buffers and writes them to the target file,
     * while handling MD5 calculation and stats update.
     * @param {Buffer[]} buffers 
     * @param {number} size 
     */
    async write_buffers(buffers, size) {
        await Promise.all([
            this.MD5Async && this._update_md5(buffers, size),
            this._write_all_buffers(buffers, size),
        ]);
        this._update_stats(size);
    }

    /**
     * Finalizes the MD5 calculation and sets the digest.
     */
    async finalize() {
        if (this.MD5Async) {
            const digest = await this.MD5Async.digest();
            this.digest = digest.toString('hex');
        }
    }

    ///////////////
    // INTERNALS //
    ///////////////

    /**
     * @param {number} size 
     */
    _update_stats(size) {
        const count = this.count_once;
        this.count_once = 0; // counting the entire operation just once
        this.stats?.update_nsfs_write_stats({
            namespace_resource_id: this.namespace_resource_id,
            size,
            count,
            bucket_name: this.bucket,
        });
    }

    /**
     * @param {Buffer[]} buffers 
     * @param {number} size 
     */
    async _update_md5(buffers, size) {
        // TODO optimize by calling once with all buffers
        for (const buf of buffers) {
            await this.MD5Async.update(buf);
        }
    }

    /**
     * Writes an array of buffers to the target file,
     * splitting them into batches if it exceeds the platform's IOV_MAX.
     * @param {Buffer[]} buffers 
     * @param {number} size 
     */
    async _write_all_buffers(buffers, size) {
        if (buffers.length <= this.iov_max) {
            await this._write_to_file(buffers, size);
        } else {
            let iov_start = 0;
            while (iov_start < buffers.length) {
                const iov_end = Math.min(buffers.length, iov_start + this.iov_max);
                const buffers_to_write = buffers.slice(iov_start, iov_end);
                const size_to_write = buffers_to_write.reduce((s, b) => s + b.length, 0);
                await this._write_to_file(buffers_to_write, size_to_write);
                iov_start = iov_end;
            }
        }
    }

    /**
     * Writes an array of buffers to the target file,
     * updating the offset and total bytes
     * @param {Buffer[]} buffers 
     * @param {number} size 
     */
    async _write_to_file(buffers, size) {
        dbg.log1(`FileWriter._write_to_file: buffers ${buffers.length} size ${size} offset ${this.offset}`);
        if (process.env.GGG_SKIP_IO === 'true' || process.env.GGG_SKIP_IO_WRITE === 'true') {
            // no-op
        } else {
            await this.target_file.writev(this.fs_context, buffers, this.offset);
        }
        if (this.offset >= 0) this.offset += size; // when offset<0 we just append
        this.total_bytes += size;
    }

    /**
     * Implements the write method of Writable stream.
     * @param {Array<{ chunk: Buffer; encoding: BufferEncoding; }>} chunks 
     * @param {(error?: Error | null) => void} callback 
     */
    async _writev(chunks, callback) {
        try {
            let size = 0;
            const buffers = chunks.map(it => {
                size += it.chunk.length;
                return it.chunk;
            });
            await this.write_buffers(buffers, size);
            return callback();
        } catch (err) {
            console.error('FileWriter._writev: failed', err);
            return callback(err);
        }
    }

    /**
     * Implements the final method of Writable stream.
     * @param {(error?: Error | null) => void} callback 
     */
    async _final(callback) {
        try {
            await this.finalize();
            return callback();
        } catch (err) {
            console.error('FileWriter._final: failed', err);
            return callback(err);
        }
    }

}

module.exports = FileWriter;
