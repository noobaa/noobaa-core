/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');
const config = require('../../config');
const nb_native = require('./nb_native');
const dbg = require('../util/debug_module')(__filename);

/**
 *
 * ChunkFS
 * 
 * Calculates etag and writes stream data to the filesystem batching data buffers
 *
 */
class ChunkFS extends stream.Transform {

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
        super();
        this.q_buffers = [];
        this.q_size = 0;
        this.MD5Async = md5_enabled ? new (nb_native().crypto.MD5Async)() : undefined;
        this.target_file = target_file;
        this.fs_context = fs_context;
        this.count = 1;
        this.total_bytes = 0;
        this.offset = offset;
        this.namespace_resource_id = namespace_resource_id;
        this.stats = stats;
        this._total_num_buffers = 0;
        const platform_iov_max = nb_native().fs.PLATFORM_IOV_MAX;
        this.iov_max = platform_iov_max ? Math.min(platform_iov_max, config.NSFS_DEFAULT_IOV_MAX) : config.NSFS_DEFAULT_IOV_MAX;
        this.bucket = bucket;
        this.large_buf_size = large_buf_size || config.NSFS_BUF_SIZE_L;
    }

    async _transform(chunk, encoding, callback) {
        try {
            if (this.MD5Async) await this.MD5Async.update(chunk);
            this.stats?.update_nsfs_write_stats({
                namespace_resource_id: this.namespace_resource_id,
                size: chunk.length,
                count: this.count,
                bucket_name: this.bucket,
            });
            this.count = 0;
            while (chunk && chunk.length) {
                const available_size = this.large_buf_size - this.q_size;
                const buf = (available_size < chunk.length) ? chunk.slice(0, available_size) : chunk;
                this.q_buffers.push(buf);
                this.q_size += buf.length;
                // Should flush when num of chunks equals to max iov which is the limit according to https://linux.die.net/man/2/writev
                // or when q_size equals to config.NSFS_BUF_SIZE_L, but added greater than just in case
                if (this.q_buffers.length === this.iov_max || this.q_size >= config.NSFS_BUF_SIZE_L) await this._flush_buffers();
                chunk = (available_size < chunk.length) ? chunk.slice(available_size) : null;
            }
            return callback();
        } catch (error) {
            console.error('ChunkFS _transform failed', this.q_size, this._total_num_buffers, error);
            return callback(error);
        }
    }

    async _flush(callback) {
        // wait before the last writev to finish
        await this._flush_buffers(callback);
    }

    // callback will be passed only at the end of the stream by _flush()
    // while this function is called without callback during _transform() and returns a promise.
    async _flush_buffers(callback) {
        try {
            if (this.q_buffers.length) {
                const buffers_to_write = this.q_buffers;
                const size_to_write = this.q_size;
                this.q_buffers = [];
                this.q_size = 0;
                dbg.log1(`Chunk_fs._flush_buffers: writing ${buffers_to_write.length} buffers, total size is ${size_to_write}`);
                await this.target_file.writev(this.fs_context, buffers_to_write, this.offset);
                // Hold the ref on the buffers from the JS side
                this._total_num_buffers += buffers_to_write.length;
                this.total_bytes += size_to_write;
                if (this.offset >= 0) this.offset += size_to_write;
            }
            if (callback) {
                if (this.MD5Async) this.digest = (await this.MD5Async.digest()).toString('hex');
                return callback();
            }
        } catch (error) {
            console.error('ChunkFS _flush_buffers failed', this.q_size, this._total_num_buffers, error);
            if (callback) {
                return callback(error);
            }
            throw error;
        }
    }
}

module.exports = ChunkFS;
