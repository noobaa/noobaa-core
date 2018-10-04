/* Copyright (C) 2016 NooBaa */
'use strict';

const mime = require('mime');

const P = require('../util/promise');
const _ = require('lodash');
const dbg = require('../util/debug_module')(__filename);


// 30 seconds delay between reports
const SEND_STATS_DELAY = 30000;
const SEND_STATS_TIMEOUT = 20000;

class EndpointStatsCollector {

    constructor(rpc_client) {
        this.rpc_client = rpc_client;
        this.reset_all_stats();
    }

    static instance(rpc_client) {
        if (!EndpointStatsCollector._instance) EndpointStatsCollector._instance = new EndpointStatsCollector(rpc_client);
        return EndpointStatsCollector._instance;
    }

    reset_all_stats() {
        this.namespace_stats = {};
        this.bucket_counters = {};
    }

    async _send_stats() {
        await P.delay(SEND_STATS_DELAY);
        // clear this.send_stats to allow new updates to trigger another _send_stats
        this.send_stats = null;
        try {
            await this.rpc_client.object.update_endpoint_stats(this.get_all_stats(), {
                timeout: SEND_STATS_TIMEOUT
            });
            this.reset_all_stats();
        } catch (err) {
            // if update fails trigger _send_stats again
            dbg.error('failed on update_endpoint_stats. trigger_send_stats again', err);
            this._trigger_send_stats();
        }
    }

    _new_namespace_stats() {
        return {
            read_count: 0,
            write_count: 0,
            read_bytes: 0,
            write_bytes: 0,
            error_write_bytes: 0,
            error_write_count: 0,
            error_read_bytes: 0,
            error_read_count: 0,
        };
    }

    update_namespace_read_stats({ namespace_resource_id, size = 0, count = 0, is_err }) {
        this.namespace_stats[namespace_resource_id] = this.namespace_stats[namespace_resource_id] || this._new_namespace_stats();
        const io_stats = this.namespace_stats[namespace_resource_id];
        if (is_err) {
            io_stats.error_read_count += count;
            io_stats.error_read_bytes += size;
        } else {
            io_stats.read_count += count;
            io_stats.read_bytes += size;
        }
        this._trigger_send_stats();
    }

    update_namespace_write_stats({ namespace_resource_id, size = 0, count = 0, is_err }) {
        this.namespace_stats[namespace_resource_id] = this.namespace_stats[namespace_resource_id] || this._new_namespace_stats();
        const io_stats = this.namespace_stats[namespace_resource_id];
        if (is_err) {
            io_stats.error_write_count += count;
            io_stats.error_write_bytes += size;
        } else {
            io_stats.write_count += count;
            io_stats.write_bytes += size;
        }
        this._trigger_send_stats();
    }

    _update_bucket_counter({ bucket_name, key, content_type, counter_key }) {
        content_type = content_type || mime.getType(key) || 'application/octet-stream';
        const accessor = `${bucket_name}#${content_type}`;
        this.bucket_counters[accessor] = this.bucket_counters[accessor] || {
            bucket_name,
            content_type,
            read_count: 0,
            write_count: 0
        };
        const counter = this.bucket_counters[accessor];
        counter[counter_key] += 1;
    }

    update_bucket_read_counters({ bucket_name, key, content_type, }) {
        this._update_bucket_counter({ bucket_name, key, content_type, counter_key: 'read_count' });
        this._trigger_send_stats();
    }

    update_bucket_write_counters({ bucket_name, key, content_type, }) {
        this._update_bucket_counter({ bucket_name, key, content_type, counter_key: 'write_count' });
        this._trigger_send_stats();
    }

    get_all_stats() {
        const namespace_stats = _.map(this.namespace_stats, (io_stats, namespace_resource_id) => ({
            io_stats,
            namespace_resource_id
        }));

        return {
            namespace_stats,
            bucket_counters: _.values(this.bucket_counters)
        };
    }

    _trigger_send_stats() {
        if (!this.send_stats) {
            this.send_stats = this._send_stats();
        }
    }
}



// EXPORTS
exports.EndpointStatsCollector = EndpointStatsCollector;
exports.instance = EndpointStatsCollector.instance;
