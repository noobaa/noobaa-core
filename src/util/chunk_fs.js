/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');
const config = require('../../config');
const stats_collector = require('../../src/sdk/endpoint_stats_collector');
const nb_native = require('./nb_native');

/**
 *
 * ChunkFS
 * 
 * Calculates etag and writes stream data to the filesystem batching data buffers
 *
 */
class ChunkFS extends stream.Transform {

    constructor({ target_file, fs_context, rpc_client, namespace_resource_id }) {
        super();
        this.q_buffers = [];
        this.q_size = 0;
        this.MD5Async = config.NSFS_CALCULATE_MD5 ? new (nb_native().crypto.MD5Async)() : undefined;
        this.target_file = target_file;
        this.fs_context = fs_context;
        this.count = 1;
        this.rpc_client = rpc_client;
        this.namespace_resource_id = namespace_resource_id;
        this._total_num_buffers = 0;
        const platform_iov_max = nb_native().fs.PLATFORM_IOV_MAX;
        this.iov_max = platform_iov_max ? Math.min(platform_iov_max, config.NSFS_DEFAULT_IOV_MAX) : config.NSFS_DEFAULT_IOV_MAX;
    }

    async _transform(chunk, encoding, callback) {
        try {
            if (this.MD5Async) await this.MD5Async.update(chunk);
            if (this.rpc_client) {
                stats_collector.instance(this.rpc_client).update_nsfs_write_stats({
                    namespace_resource_id: this.namespace_resource_id,
                    size: chunk.length,
                    count: this.count
                });
            }
            this.count = 0;
            while (chunk && chunk.length) {
                const available_size = config.NSFS_BUF_SIZE - this.q_size;
                const buf = (available_size < chunk.length) ? chunk.slice(0, available_size) : chunk;
                this.q_buffers.push(buf);
                this.q_size += buf.length;
                // Should flush when num of chunks equals to max iov which is the limit according to https://linux.die.net/man/2/writev
                // or when q_size equals to config.NSFS_BUF_SIZE, but added greater than just in case
                if (this.q_buffers.length === this.iov_max || this.q_size >= config.NSFS_BUF_SIZE) await this._flush_buffers();
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
                this.q_buffers = [];
                this.q_size = 0;
                await this.target_file.writev(this.fs_context, buffers_to_write);
                // Hold the ref on the buffers from the JS side
                this._total_num_buffers += buffers_to_write.length;
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
