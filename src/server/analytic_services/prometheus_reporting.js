/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const prom_client = require('prom-client');
const config = require('../../../config.js');

function get_metric_name(name) {
    return config.PROMETHEUS_PREFIX + name;
}

//POC Only
//Need to look at alerting as well
class PrometheusReporting {
    static instance() {
        PrometheusReporting._instance = PrometheusReporting._instance || new PrometheusReporting();
        return PrometheusReporting._instance;
    }

    constructor() {
        this._prom_client = prom_client;
        if (this.enabled()) {
            this.define_metrics();
        }
    }

    client() {
        return this._prom_client;
    }

    enabled() {
        return config.PROMETHEUS_ENABLED;
    }

    define_metrics() {
        this._metrics = {};
        prom_client.collectDefaultMetrics({ prefix: get_metric_name('defaults_') });

        //POC grade only, need to define actual interesting metrics
        //Currently called from stats_aggregator, md_aggregator and other stats collectors are probebly as interesting to look at

        //This is a gauge type metric, can be incremented/decremented and reset
        this._metrics.cloud_types = new prom_client.Gauge({
            name: get_metric_name('cloud_types'),
            help: 'Cloud Resource Types in the System',
            labelNames: ['type', 'count']
        });

        this._metrics.object_histo = new prom_client.Gauge({
            name: get_metric_name('object_histo'),
            help: 'Object Sizes Histogram Across the System',
            labelNames: ['size', 'avg', 'count']
        });

        this._metrics.cloud_bandwidth = new prom_client.Gauge({
            name: get_metric_name('cloud_bandwidth'),
            help: 'Cloud bandwidth usage',
            labelNames: ['type', 'size']
        });

        this._metrics.cloud_ops = new prom_client.Gauge({
            name: get_metric_name('cloud_ops'),
            help: 'Cloud number of operations',
            labelNames: ['type', 'number']
        });

        this._metrics.system_capacity = new prom_client.Gauge({
            name: get_metric_name('system_capacity'),
            help: 'System capacity',
        });
    }

    export_metrics() {
        const exported = this._prom_client.register.getSingleMetricAsString(get_metric_name('cloud_types')) + '\n' +
            this._prom_client.register.getSingleMetricAsString(get_metric_name('object_histo')) + '\n' +
            this._prom_client.register.getSingleMetricAsString(get_metric_name('cloud_bandwidth')) + '\n' +
            this._prom_client.register.getSingleMetricAsString(get_metric_name('system_capacity')) + '\n' +
            this._prom_client.register.getSingleMetricAsString(get_metric_name('cloud_ops'));

        return exported;
    }

    set_cloud_types(types) {
        if (!this.enabled()) return;
        this._metrics.cloud_types.set({ type: 'AWS' }, types.cloud_pool_target.amazon);
        this._metrics.cloud_types.set({ type: 'Azure' }, types.cloud_pool_target.azure);
        this._metrics.cloud_types.set({ type: 'GCP' }, types.cloud_pool_target.gcp);
        this._metrics.cloud_types.set({ type: 'Other' }, types.cloud_pool_target.other);
    }

    set_object_sizes(sizes) {
        if (!this.enabled()) return;
        for (const bin of sizes) {
            if (!_.isEmpty(bin.bins)) {
                for (const cur of bin.bins) {
                    this._metrics.object_histo.set({ size: cur.label, avg: cur.avg }, cur.count, new Date());
                }
            }
        }
    }

    set_cloud_bandwidth(type, write_size, read_size) {
        if (!this.enabled()) return;
        this._metrics.cloud_bandwidth.set({ type: type + '_write_size' }, write_size);
        this._metrics.cloud_bandwidth.set({ type: type + '_read_size' }, read_size);
    }

    set_cloud_ops(type, write_num, read_num) {
        if (!this.enabled()) return;
        this._metrics.cloud_ops.set({ type: type + '_write_ops' }, write_num);
        this._metrics.cloud_ops.set({ type: type + '_read_ops' }, read_num);
    }

    set_system_capacity(capacity_num) {
        if (!this.enabled()) return;
        this._metrics.system_capacity.set(capacity_num);
    }

    update_cloud_bandwidth(type, write_size, read_size) {
        if (!this.enabled()) return;
        this._metrics.cloud_bandwidth.inc({ type: type + '_write_size' }, write_size, new Date());
        this._metrics.cloud_bandwidth.inc({ type: type + '_read_size' }, read_size, new Date());
    }

    update_cloud_ops(type, write_num, read_num) {
        if (!this.enabled()) return;
        this._metrics.cloud_ops.inc({ type: type + '_write_ops' }, write_num, new Date());
        this._metrics.cloud_ops.inc({ type: type + '_read_ops' }, read_num, new Date());
    }
}

// EXPORTS
exports.PrometheusReporting = PrometheusReporting;
