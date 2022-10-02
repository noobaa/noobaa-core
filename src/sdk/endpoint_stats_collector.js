/* Copyright (C) 2016 NooBaa */
'use strict';

const mime = require('mime');

const P = require('../util/promise');
const _ = require('lodash');
const dbg = require('../util/debug_module')(__filename);
const prom_report = require('../server/analytic_services/prometheus_reporting');


// 30 seconds delay between reports
const SEND_STATS_DELAY = 30000;
const SEND_STATS_TIMEOUT = 20000;

let global_fs_stats = {};

function report_fs_stats(fs_worker_stats) {
    const time_in_microsec = Math.floor(fs_worker_stats.took_time * 1000);
    global_fs_stats[fs_worker_stats.name.toLowerCase()] = global_fs_stats[fs_worker_stats.name.toLowerCase()] || {
        min_time: time_in_microsec,
        max_time: time_in_microsec,
        sum_time: 0,
        count: 0,
        error_count: 0,
    };
    const global_fs_stat = global_fs_stats[fs_worker_stats.name.toLowerCase()];
    if (fs_worker_stats.error === 0) {
        global_fs_stat.min_time = Math.min(global_fs_stat.min_time, time_in_microsec);
        global_fs_stat.max_time = Math.max(global_fs_stat.max_time, time_in_microsec);
        global_fs_stat.sum_time += time_in_microsec;
    }
    global_fs_stat.count += 1;
    global_fs_stat.error_count += fs_worker_stats.error;
}
class EndpointStatsCollector {

    constructor(rpc_client) {
        this.rpc_client = rpc_client;
        this.op_stats = {};
        this.fs_workers_stats = {};
        this.reset_all_stats();
        this.nsfs_io_counters = this._new_namespace_stats();
        this.prom_metrics_report = prom_report.get_endpoint_report();
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
        await P.all([this._send_endpoint_stats(), this._send_nsfs_stats()]);
    }

    async _send_endpoint_stats() {
        await P.delay_unblocking(SEND_STATS_DELAY);
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

    // _send_nsfs_stats will not retry update_nsfs_stats, We can send it in the next iteration.
    async _send_nsfs_stats() {
        const _nsfs_stats = {
            nsfs_stats: {
                io_stats: this.nsfs_io_counters,
                op_stats: this.op_stats,
                fs_workers_stats: this.fs_workers_stats,
            }
        };
        try {
            await this.rpc_client.stats.update_nsfs_stats(_nsfs_stats, {
                timeout: SEND_STATS_TIMEOUT
            });
            this.nsfs_io_counters = this._new_namespace_stats();
            this.op_stats = {};
            this.fs_workers_stats = {};
        } catch (err) {
            dbg.error('failed on update_nsfs_stats.', err);
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

    update_namespace_read_stats({ namespace_resource_id, bucket_name, size = 0, count = 0, is_err }) {
        this.namespace_stats[namespace_resource_id] = this.namespace_stats[namespace_resource_id] || this._new_namespace_stats();
        const io_stats = this.namespace_stats[namespace_resource_id];
        if (is_err) {
            io_stats.error_read_count += count;
            io_stats.error_read_bytes += size;
        } else {
            io_stats.read_count += count;
            io_stats.read_bytes += size;
        }
        if (bucket_name) {
            this.prom_metrics_report.inc('hub_read_bytes', { bucket_name }, size);
        }
        this._trigger_send_stats();
    }

    update_namespace_write_stats({ namespace_resource_id, bucket_name, size = 0, count = 0, is_err }) {
        this.namespace_stats[namespace_resource_id] = this.namespace_stats[namespace_resource_id] || this._new_namespace_stats();
        const io_stats = this.namespace_stats[namespace_resource_id];
        if (is_err) {
            io_stats.error_write_count += count;
            io_stats.error_write_bytes += size;
        } else {
            io_stats.write_count += count;
            io_stats.write_bytes += size;
        }
        if (bucket_name) {
            this.prom_metrics_report.inc('hub_write_bytes', { bucket_name }, size);
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

    update_ops_counters({ time, op_name, error = 0 }) {
        this._update_fs_worker_stats();
        this.op_stats[op_name] = this.op_stats[op_name] || {
            min_time: time,
            max_time: time,
            sum_time: 0,
            count: 0,
            error_count: 0,
        };
        const ops_stats = this.op_stats[op_name];
        if (error === 0) {
            ops_stats.min_time = Math.min(ops_stats.min_time, time);
            ops_stats.max_time = Math.max(ops_stats.max_time, time);
            ops_stats.sum_time += time;
        }
        ops_stats.count += 1;
        ops_stats.error_count += error;
        this._trigger_send_stats();
    }

    _update_fs_worker_stats() {
        //Go over the fs_workers_stats and update
        for (const [key, value] of Object.entries(global_fs_stats)) {
            const fs_stat = this.fs_workers_stats[key] || {
                min_time: value.min_time,
                max_time: value.min_time,
                sum_time: 0,
                count: 0,
                error_count: 0,
            };
            fs_stat.min_time = Math.min(fs_stat.min_time, value.min_time);
            fs_stat.max_time = Math.max(fs_stat.max_time, value.max_time);
            fs_stat.sum_time += value.sum_time;
            fs_stat.count += value.count;
            fs_stat.error_count += value.error_count;
            this.fs_workers_stats[key] = fs_stat;
        }
        global_fs_stats = {};
    }

    update_bucket_read_counters({ bucket_name, key, content_type, }) {
        this._update_bucket_counter({ bucket_name, key, content_type, counter_key: 'read_count' });
        this._trigger_send_stats();
    }

    update_bucket_write_counters({ bucket_name, key, content_type, }) {
        this._update_bucket_counter({ bucket_name, key, content_type, counter_key: 'write_count' });
        this._trigger_send_stats();
    }

    update_nsfs_read_stats({ namespace_resource_id, bucket_name, size = 0, count = 0, is_err }) {
        this.update_namespace_read_stats({ namespace_resource_id, bucket_name, size, count, is_err });
        this.update_nsfs_read_counters({ size, count, is_err });
    }

    update_nsfs_read_counters({ size = 0, count = 0, is_err }) {
        if (is_err) {
            this.nsfs_io_counters.error_read_count += count;
            this.nsfs_io_counters.error_read_bytes += size;
        } else {
            this.nsfs_io_counters.read_count += count;
            this.nsfs_io_counters.read_bytes += size;
        }
    }

    update_nsfs_write_stats({ namespace_resource_id, bucket_name, size = 0, count = 0, is_err }) {
        this.update_namespace_write_stats({ namespace_resource_id, bucket_name, size, count, is_err });
        this.update_nsfs_write_counters({ size, count, is_err });
    }

    update_nsfs_write_counters({ size = 0, count = 0, is_err }) {
        if (is_err) {
            this.nsfs_io_counters.error_write_count += count;
            this.nsfs_io_counters.error_write_bytes += size;
        } else {
            this.nsfs_io_counters.write_count += count;
            this.nsfs_io_counters.write_bytes += size;
        }
    }

    update_cache_stats({ bucket_name, read_bytes, write_bytes, read_count = 0, miss_count = 0, hit_count = 0, range_op = false }) {
        if (read_bytes) {
            this.prom_metrics_report.inc('cache_read_bytes', { bucket_name }, read_bytes);
        }
        if (read_count) {
            this.prom_metrics_report.inc(range_op ? 'cache_range_read_count' : 'cache_object_read_count', { bucket_name }, read_count);
        }
        if (miss_count) {
            this.prom_metrics_report.inc(range_op ? 'cache_range_read_miss_count' : 'cache_object_read_miss_count', { bucket_name }, miss_count);
        }
        if (hit_count) {
            this.prom_metrics_report.inc(range_op ? 'cache_range_read_hit_count' : 'cache_object_read_hit_count', { bucket_name }, hit_count);
        }
        if (write_bytes) {
            this.prom_metrics_report.inc('cache_write_bytes', { bucket_name }, write_bytes);
        }
    }

    update_cache_latency_stats({ bucket_name, cache_read_latency, cache_write_latency }) {
        if (cache_read_latency) {
            this.prom_metrics_report.observe('cache_read_latency', { bucket_name }, cache_read_latency);
        }
        if (cache_write_latency) {
            this.prom_metrics_report.observe('cache_write_latency', { bucket_name }, cache_write_latency);
        }
    }

    update_hub_latency_stats({ bucket_name, hub_read_latency, hub_write_latency }) {
        if (hub_read_latency) {
            this.prom_metrics_report.observe('hub_read_latency', { bucket_name }, hub_read_latency);
        }
        if (hub_write_latency) {
            this.prom_metrics_report.observe('hub_write_latency', { bucket_name }, hub_write_latency);
        }
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

EndpointStatsCollector._instance = null;

// EXPORTS
exports.EndpointStatsCollector = EndpointStatsCollector;
exports.instance = EndpointStatsCollector.instance;
exports.report_fs_stats = report_fs_stats;
