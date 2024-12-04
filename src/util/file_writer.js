/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');
const config = require('../../config');
const nb_native = require('./nb_native');
const dbg = require('../util/debug_module')(__filename);

/**
 * FileWriter is a Writable stream that write data to a filesystem file,
 * with optional calculation of md5 for etag.
 */
class FileWriter extends stream.Writable {

    /**
     * @param {{
     *      target_file: object,
     *      fs_context: object,
     *      namespace_resource_id: string,
     *      md5_enabled: boolean,
     *      stats: import('../sdk/endpoint_stats_collector').EndpointStatsCollector,
     *      offset?: number,
     *      bucket?: string,
     *      large_buf_size?: number,
     * }} params
     */
    constructor({ target_file, fs_context, namespace_resource_id, md5_enabled, stats, offset, bucket, large_buf_size }) {
        super({ highWaterMark: config.NFSF_UPLOAD_STREAM_MEM_THRESHOLD });
        this.target_file = target_file;
        this.fs_context = fs_context;
        this.offset = offset;
        this.total_bytes = 0;
        this.count_once = 1;
        this.stats = stats;
        this.bucket = bucket;
        this.namespace_resource_id = namespace_resource_id;
        this.large_buf_size = large_buf_size || config.NSFS_BUF_SIZE_L;
        this.MD5Async = md5_enabled ? new (nb_native().crypto.MD5Async)() : undefined;
        const platform_iov_max = nb_native().fs.PLATFORM_IOV_MAX;
        this.iov_max = platform_iov_max ? Math.min(platform_iov_max, config.NSFS_DEFAULT_IOV_MAX) : config.NSFS_DEFAULT_IOV_MAX;
    }

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
     * @param {Buffer[]} buffers 
     * @param {number} size 
     */
    async _write_to_file(buffers, size) {
        dbg.log1(`FileWriter._write_to_file: buffers ${buffers.length} size ${size} offset ${this.offset}`);
        await this.target_file.writev(this.fs_context, buffers, this.offset);
        if (this.offset >= 0) this.offset += size; // when offset<0 we just append
        this.total_bytes += size;
    }

    /**
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
            await Promise.all([
                this.MD5Async && this._update_md5(buffers, size),
                this._write_all_buffers(buffers, size),
            ]);
            this._update_stats(size);
            return callback();
        } catch (err) {
            console.error('FileWriter._writev: failed', err);
            return callback(err);
        }
    }

    /**
     * @param {(error?: Error | null) => void} callback 
     */
    async _final(callback) {
        try {
            if (this.MD5Async) {
                const digest = await this.MD5Async.digest();
                this.digest = digest.toString('hex');
            }

            return callback();
        } catch (err) {
            console.error('FileWriter._final: failed', err);
            return callback(err);
        }
    }

}

module.exports = FileWriter;
