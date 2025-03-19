/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mime = require('mime-types');

const dbg = require('../util/debug_module')(__filename);
const prom_report = require('../server/analytic_services/prometheus_reporting');
const stats_aggregator = require('../server/system_services/stats_aggregator');
const DelayedCollector = require('../util/delayed_collector');
const config = require('../../config');
const cluster = /** @type {import('node:cluster').Cluster} */ (
    /** @type {unknown} */
    (require('node:cluster'))
);

/**
 * @typedef {{
 *      read_count?: number;
 *      write_count?: number;
 *      read_bytes?: number;
 *      write_bytes?: number;
 *      error_write_bytes?: number;
 *      error_write_count?: number;
 *      error_read_bytes?: number;
 *      error_read_count?: number;
 * }} IoStats
 * 
 * @typedef {{
 *      count?: number;
 *      error_count?: number;
 *      min_time?: number;
 *      max_time?: number;
 *      sum_time?: number;
 * }} OpStats
 * 
 * @typedef {{
 *      bucket_counters?: { [bucket_name: string]: { [content_type: string]: IoStats } }
 *      namespace_stats?: { [namespace_resource_id: string]: IoStats }
 * }} EndpointStats
 * 
 * @typedef {{
 *      io_stats?: IoStats;
 *      op_stats?: { [op: string]: OpStats }
 *      fs_workers_stats?: { [op: string]: OpStats }
 * }} NsfsStats
 * 
 */

// 30 seconds delay between reports
const SEND_STATS_DELAY = 30000;
// 10 seconds delay between nsfs reports
const SEND_NSFS_STATS_DELAY = 10000;
// 20 seconds timeout for sending reports
const SEND_STATS_TIMEOUT = 20000;
// do not retry forever, even if gave up, updates are in memory
// and it will be sent again once new updates cause it to trigger.
const SEND_STATS_MAX_RETRIES = 3;

class EndpointStatsCollector {

    constructor() {

        // collector implmenetations handle incoming stats updates, and triggers a delayed processing,
        // so that many update calls can be coalesced to a single call to the server.

        this.endpoint_stats_collector = new DelayedCollector({
            delay: SEND_STATS_DELAY,
            max_retries: SEND_STATS_MAX_RETRIES,
            merge_func,
            /** @param {EndpointStats} data */
            process_func: data => this._process_endpoint_stats(data),
        });

        this.nsfs_stats_collector = new DelayedCollector({
            delay: SEND_NSFS_STATS_DELAY,
            max_retries: SEND_STATS_MAX_RETRIES,
            merge_func,
            /** @param {NsfsStats} data */
            process_func: data => this._process_nsfs_stats(data),
        });

        // optional rpc_client (see set_rpc_client) will be used to send collected stats to server.\
        // when null the stats are still printed to log.
        /** @type {nb.APIClient} */
        this.rpc_client = null;

        // exposing a self-bound reporter function (to be used as callback without `this` from native code)
        this.update_fs_stats = fs_worker_stats => this._update_fs_stats(fs_worker_stats);

        this.prom_metrics_report = prom_report.get_endpoint_report();
        this.semaphore_reports = {
            object_io: [],
            nsfs_l: [],
            nsfs_m: [],
            nsfs_s: [],
            nsfs_xs: [],
        };
    }

    static instance() {
        if (!EndpointStatsCollector._instance) EndpointStatsCollector._instance = new EndpointStatsCollector();
        return EndpointStatsCollector._instance;
    }

    /**
     * @param {nb.APIClient} rpc_client 
     */
    set_rpc_client(rpc_client) {
        this.rpc_client = rpc_client;
    }

    /**
     * @param {EndpointStats} data 
     * @returns {Promise<void>}
     */
    async _process_endpoint_stats(data) {

        const bucket_counters = Object.entries(data.bucket_counters ?? {}).flatMap(
            ([bucket_name, bkt]) => Object.entries(bkt).map(
                ([content_type, io_stats]) => {
                    dbg.log0(`bucket stats - ${bucket_name} ${content_type} :`, io_stats);
                    return {
                        bucket_name,
                        content_type,
                        read_count: io_stats.read_count,
                        write_count: io_stats.write_count,
                    };
                }
            )
        );

        const namespace_stats = Object.entries(data.namespace_stats ?? {}).map(
            ([namespace_resource_id, io_stats]) => {
                dbg.log0(`namespace stats - ${namespace_resource_id} :`, io_stats);
                return {
                    namespace_resource_id,
                    io_stats: { ...io_stats }, // make shallow copy
                };
            }
        );

        if (this.rpc_client) {
            await this.rpc_client.object.update_endpoint_stats({
                bucket_counters,
                namespace_stats,
            }, {
                timeout: SEND_STATS_TIMEOUT
            });
        }
    }

    /**
     * @param {NsfsStats} data
     * @returns {Promise<void>}
     */
    async _process_nsfs_stats(data) {
        dbg.log0('nsfs stats - IO counters :', data.io_stats);
        for (const [k, v] of Object.entries(data.op_stats ?? {})) {
            dbg.log0(`nsfs stats - S3 op=${k} :`, v);
        }
        for (const [k, v] of Object.entries(data.fs_workers_stats ?? {})) {
            dbg.log0(`nsfs stats - FS op=${k} :`, v);
        }
        if (this.rpc_client) {
            await this.rpc_client.stats.update_nsfs_stats({
                nsfs_stats: data
            }, {
                timeout: SEND_STATS_TIMEOUT
            });
        } else {
            await stats_aggregator.standalon_update_nsfs_stats(data);
        }
    }

    _update_fs_stats(fs_worker_stats) {
        const time = Math.floor(fs_worker_stats.took_time * 1000); // microsec
        const op_name = fs_worker_stats.name.toLowerCase();
        const error = fs_worker_stats.error;
        this.nsfs_stats_collector.update({
            fs_workers_stats: {
                [op_name]: {
                    count: 1,
                    error_count: error,
                    min_time: error ? undefined : time,
                    max_time: error ? undefined : time,
                    sum_time: error ? undefined : time,
                }
            }
        });
    }

    update_namespace_read_stats({ namespace_resource_id, bucket_name = undefined, size = 0, count = 0, is_err = false }) {
        this.endpoint_stats_collector.update({
            namespace_stats: {
                [namespace_resource_id]: is_err ? {
                    error_read_count: count,
                    error_read_bytes: size,
                } : {
                    read_count: count,
                    read_bytes: size,
                }
            }
        });
        if (bucket_name) {
            this.prom_metrics_report.inc('hub_read_bytes', { bucket_name }, size);
        }
    }

    update_namespace_write_stats({ namespace_resource_id, bucket_name = undefined, size = 0, count = 0, is_err = false }) {
        this.endpoint_stats_collector.update({
            namespace_stats: {
                [namespace_resource_id]: is_err ? {
                    error_write_count: count,
                    error_write_bytes: size,
                } : {
                    write_count: count,
                    write_bytes: size,
                }
            }
        });
        if (bucket_name) {
            this.prom_metrics_report.inc('hub_write_bytes', { bucket_name }, size);
        }
    }

    update_ops_counters({ time, op_name, error = 0, trigger_send = true }) {
        // trigger_send is for ops that we want to collect metrics but avoid sending it (upload part for example).
        this.nsfs_stats_collector.update({
            op_stats: {
                [op_name]: {
                    count: 1,
                    error_count: error,
                    min_time: error ? undefined : time,
                    max_time: error ? undefined : time,
                    sum_time: error ? undefined : time,
                }
            }
        }, !trigger_send);
    }

    update_bucket_read_counters({ bucket_name, key, content_type, }) {
        content_type = content_type || mime.lookup(key) || 'application/octet-stream';
        this.endpoint_stats_collector.update({
            bucket_counters: {
                [bucket_name]: {
                    [content_type]: { read_count: 1 } } }
        });
    }

    update_bucket_write_counters({ bucket_name, key, content_type, }) {
        content_type = content_type || mime.lookup(key) || 'application/octet-stream';
        this.endpoint_stats_collector.update({
            bucket_counters: {
                [bucket_name]: {
                    [content_type]: { write_count: 1 } } }
        });
    }

    update_semaphore_state(report, type, report_sample_sizes) {
        if (!this.semaphore_reports[type]) {
            throw new Error(`Semaphore report type ${type} is not valid`);
        }
        this.semaphore_reports[type].push(report);
        if (this.semaphore_reports[type].length > report_sample_sizes[report_sample_sizes.length - 1]) {
            this.semaphore_reports[type].shift();
        }
        const average_intervals = [];
        for (const sample_size of report_sample_sizes) {
            if (this.semaphore_reports[type].length < sample_size) {
                return;
            }
            // Convert the sampling size to sampling average interval
            const average_interval = (sample_size * config.SEMAPHORE_MONITOR_DELAY) / (60 * 1000);
            average_intervals.push(average_interval);
            const average_values = this.semaphore_reports[type].slice(this.semaphore_reports[type].length - sample_size);
            this.update_semaphore_reports(average_values, { type, average_interval }, average_intervals);
        }

    }

    update_semaphore_reports(reports, labels, average_intervals) {
        this.prom_metrics_report.set('semaphore_value', labels, reports, average_intervals);
        this.prom_metrics_report.set('semaphore_waiting_value', labels, reports, average_intervals);
        this.prom_metrics_report.set('semaphore_waiting_time', labels, reports, average_intervals);
        this.prom_metrics_report.set('semaphore_waiting_queue', labels, reports, average_intervals);
    }

    update_nsfs_read_stats({ namespace_resource_id, bucket_name = undefined, size = 0, count = 0, is_err = false }) {
        this.update_namespace_read_stats({ namespace_resource_id, bucket_name, size, count, is_err });
        this.update_nsfs_read_counters({ size, count, is_err });
    }

    update_nsfs_write_stats({ namespace_resource_id, bucket_name = undefined, size = 0, count = 0, is_err = false }) {
        this.update_namespace_write_stats({ namespace_resource_id, bucket_name, size, count, is_err });
        this.update_nsfs_write_counters({ size, count, is_err });
    }

    update_nsfs_read_counters({ size = 0, count = 0, is_err = false }) {
        this.nsfs_stats_collector.update({
            io_stats: is_err ? {
                error_read_count: count,
                error_read_bytes: size,
            } : {
                read_count: count,
                read_bytes: size,
            }
        });
    }

    update_nsfs_write_counters({ size = 0, count = 0, is_err = false }) {
        this.nsfs_stats_collector.update({
            io_stats: is_err ? {
                error_write_count: count,
                error_write_bytes: size,
            } : {
                write_count: count,
                write_bytes: size,
            }
        });
    }

    update_cache_stats({
        bucket_name,
        read_bytes = 0,
        write_bytes = 0,
        read_count = 0,
        miss_count = 0,
        hit_count = 0,
        range_op = false,
    }) {
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

    update_cache_latency_stats({ bucket_name, cache_read_latency = 0, cache_write_latency = 0 }) {
        if (cache_read_latency) {
            this.prom_metrics_report.observe('cache_read_latency', { bucket_name }, cache_read_latency);
        }
        if (cache_write_latency) {
            this.prom_metrics_report.observe('cache_write_latency', { bucket_name }, cache_write_latency);
        }
    }

    update_hub_latency_stats({ bucket_name, hub_read_latency = 0, hub_write_latency = 0 }) {
        if (hub_read_latency) {
            this.prom_metrics_report.observe('hub_read_latency', { bucket_name }, hub_read_latency);
        }
        if (hub_write_latency) {
            this.prom_metrics_report.observe('hub_write_latency', { bucket_name }, hub_write_latency);
        }
    }
    update_fork_counter() {
        // add fork related metrics to prometheus
        const code = `worker_${cluster.worker.id}`;
        this.prom_metrics_report.inc('fork_counter', { code });
    }
}
if (cluster.isWorker) {
    EndpointStatsCollector.instance().update_fork_counter();
}

EndpointStatsCollector._instance = null;

function merge_func(data, updates) {
    return _.mergeWith(data, updates, (value, update, key, object, source) => {
        if (typeof update === 'number') {
            if (key.startsWith('min')) {
                return Math.min(value ?? Infinity, update);
            } else if (key.startsWith('max')) {
                return Math.max(value ?? -Infinity, update);
            } else {
                return (value ?? 0) + update;
            }
        }
    });
}


// EXPORTS
exports.EndpointStatsCollector = EndpointStatsCollector;
exports.instance = EndpointStatsCollector.instance;
