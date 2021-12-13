/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');
const config = require('../../config');
const stats_collector = require('../../src/sdk/endpoint_stats_collector');
const nb_native = require('./nb_native');

/**
 *
 * ChunkNSFS
 * 
 * Calculates etag and writes stream data to the filesystem batching data buffers
 *
 */
class ChunkFS extends stream.Transform {

    constructor({ target_file, fs_account_config, rpc_client, namespace_resource_id }) {
        super();
        this.q_buffers = [];
        this.q_size = 0;
        this.MD5Async = config.NSFS_CALCULATE_MD5 ? new (nb_native().crypto.MD5Async)() : undefined;
        this.target_file = target_file;
        this.fs_account_config = fs_account_config;
        this.count = 1;
        this.rpc_client = rpc_client;
        this.namespace_resource_id = namespace_resource_id;
    }

    _transform(chunk, encoding, callback) {
        try {
            this._process_chunk(chunk, callback);
        } catch (error) {
            return callback(error);
        }
    }

    _flush(callback) {
        try {
            this._flush_buffers(callback);
        } catch (error) {
            return callback(error);
        }
    }

    async _flush_buffers(callback) {
        if (this.q_buffers.length) {
            const buffers_to_write = this.q_buffers;
            this.q_buffers = [];
            this.q_size = 0;
            await this.target_file.writev(this.fs_account_config, buffers_to_write);
        }
        if (callback) {
            if (this.MD5Async) this.digest = (await this.MD5Async.digest()).toString('hex');
            return callback();
        }
    }

    async _process_chunk(data, callback) {
        if (this.MD5Async) await this.MD5Async.update(data);
        stats_collector.instance(this.rpc_client).update_namespace_write_stats({
            namespace_resource_id: this.namespace_resource_id,
            size: data.length,
            count: this.count
        });
        this.count = 0;
        while (data && data.length) {
            const available_size = config.NSFS_BUF_SIZE - this.q_size;
            const buf = (available_size < data.length) ? data.slice(0, available_size) : data;
            this.q_buffers.push(buf);
            this.q_size += buf.length;
            if (this.q_size === config.NSFS_BUF_SIZE) await this._flush_buffers();
            data = (available_size < data.length) ? data.slice(available_size) : null;
        }
        return callback();
    }
}

module.exports = ChunkFS;
