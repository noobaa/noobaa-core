/* Copyright (C) 2016 NooBaa */
'use strict';

const mime = require('mime');

const promise_utils = require('../util/promise_utils');
const _ = require('lodash');
const dbg = require('../util/debug_module')(__filename);
const prom_report = require('../server/analytic_services/prometheus_reporting');


// 30 seconds delay between reports
const SEND_STATS_DELAY = 30000;
const SEND_STATS_TIMEOUT = 20000;

class EndpointStatsCollector {

    constructor(rpc_client) {
        this.rpc_client = rpc_client;
        this.reset_all_stats();
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
        await promise_utils.delay_unblocking(SEND_STATS_DELAY);
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
        this._update_hub_read_stats({
            bucket_name: bucket_name,
            size: size
        })
    }

    _update_hub_read_stats({ bucket_name, size = 0 }) {
        this.prom_metrics_report.inc('hub_read_bytes', { bucket_name }, size);
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
        this._update_hub_write_stats({
            bucket_name: bucket_name,
            size: size
        })
    }

    _update_hub_write_stats({ bucket_name, size = 0 }) {
        this.prom_metrics_report.inc('hub_write_bytes', { bucket_name }, size);
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

    update_cache_stats({ bucket_name, read_bytes, write_bytes, read_count = 0, miss_count = 0, range_op = false }) {
        if (read_bytes) {
            this.prom_metrics_report.inc('cache_read_bytes', { bucket_name }, read_bytes);
        }
        if (read_count) {
            this.prom_metrics_report.inc(range_op ? 'cache_range_read_count' : 'cache_object_read_count',
                { bucket_name }, read_count);
        }
        if (miss_count) {
            this.prom_metrics_report.inc(range_op ? 'cache_range_read_miss_count' : 'cache_object_read_miss_count',
                { bucket_name }, miss_count);
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



// EXPORTS
exports.EndpointStatsCollector = EndpointStatsCollector;
exports.instance = EndpointStatsCollector.instance;
