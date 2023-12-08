/* Copyright (C) 2016 NooBaa */
'use strict';

const { BasePrometheusReport } = require('./base_prometheus_report');
const js_utils = require('../../../util/js_utils');

// -----------------------------------------
// A report for collecting endpoint metrics,
// this class is a shim that should who ever
// come next to add endpoint metrics reporting.
// -----------------------------------------

const nsfs_suffix = "_nsfs";
const NOOBAA_ENDPOINT_METRICS = js_utils.deep_freeze([{
        type: 'Counter',
        name: 'hub_read_bytes',
        configuration: {
            help: 'hub read bytes in namespace cache bucket',
            labelNames: ['bucket_name']
        }
    },
    {
        type: 'Counter',
        name: 'hub_write_bytes',
        configuration: {
            help: 'hub write bytes in namespace cache bucket',
            labelNames: ['bucket_name']
        }
    },
    {
        type: 'Counter',
        name: 'cache_read_bytes',
        configuration: {
            help: 'Cache read bytes in namespace cache bucket',
            labelNames: ['bucket_name']
        }
    },
    {
        type: 'Counter',
        name: 'cache_write_bytes',
        configuration: {
            help: 'Cache write bytes in namespace cache bucket',
            labelNames: ['bucket_name']
        }
    },
    {
        type: 'Counter',
        name: 'cache_object_read_count',
        configuration: {
            help: 'Counter on entire object reads in namespace cache bucket',
            labelNames: ['bucket_name']
        }
    },
    {
        type: 'Counter',
        name: 'cache_object_read_miss_count',
        configuration: {
            help: 'Counter on entire object read miss in namespace cache bucket',
            labelNames: ['bucket_name']
        }
    },
    {
        type: 'Counter',
        name: 'cache_object_read_hit_count',
        configuration: {
            help: 'Counter on entire object read hit in namespace cache bucket',
            labelNames: ['bucket_name']
        }
    },
    {
        type: 'Counter',
        name: 'cache_range_read_count',
        configuration: {
            help: 'Counter on range reads in namespace cache bucket',
            labelNames: ['bucket_name']
        }
    },
    {
        type: 'Counter',
        name: 'cache_range_read_miss_count',
        configuration: {
            help: 'Counter on range read miss in namespace cache bucket',
            labelNames: ['bucket_name']
        }
    },
    {
        type: 'Counter',
        name: 'cache_range_read_hit_count',
        configuration: {
            help: 'Counter on range read hit in namespace cache bucket',
            labelNames: ['bucket_name']
        }
    },
    {
        type: 'Histogram',
        name: 'hub_read_latency',
        configuration: {
            help: 'hub read latency in namespace cache bucket',
            labelNames: ['bucket_name'],
            buckets: [
                0.001,
                0.01,
                0.1, 0.2, 0.5,
                1, 2, 5,
                10, 20, 50,
                100, 200, 500,
                1000, 2000, 5000,
                10000, 20000, 50000,
            ],
        }
    },
    {
        type: 'Histogram',
        name: 'hub_write_latency',
        configuration: {
            help: 'hub write latency in namespace cache bucket',
            labelNames: ['bucket_name'],
            buckets: [
                0.001,
                0.01,
                0.1, 0.2, 0.5,
                1, 2, 5,
                10, 20, 50,
                100, 200, 500,
                1000, 2000, 5000,
                10000, 20000, 50000,
            ],
        }
    },
    {
        type: 'Histogram',
        name: 'cache_read_latency',
        configuration: {
            help: 'Cache read latency in namespace cache bucket',
            labelNames: ['bucket_name'],
            buckets: [
                0.001,
                0.01,
                0.1, 0.2, 0.5,
                1, 2, 5,
                10, 20, 50,
                100, 200, 500,
                1000, 2000, 5000,
                10000, 20000, 50000,
            ],
        }
    },
    {
        type: 'Histogram',
        name: 'cache_write_latency',
        configuration: {
            help: 'Cache write latency in namespace cache bucket',
            labelNames: ['bucket_name'],
            buckets: [
                0.001,
                0.01,
                0.1, 0.2, 0.5,
                1, 2, 5,
                10, 20, 50,
                100, 200, 500,
                1000, 2000, 5000,
                10000, 20000, 50000,
            ],
        }
    },
    {
        type: 'Gauge',
        name: 'semaphore_waiting_value',
        configuration: {
            help: 'Namespace semaphore waiting value',
            labelNames: ['type', 'average_interval']
        },
        collect: function(prom_instance, labels, values) {
            let total_values = 0;
            for (const value of values) {
                total_values += value.semaphore_state.waiting_value;
            }
            prom_instance.set(labels, total_values / values.length);
            total_values = 0;
        },
    },
    {
        type: 'Gauge',
        name: 'semaphore_waiting_time',
        configuration: {
            help: 'Namespace semaphore waiting time',
            labelNames: ['type', 'average_interval']
        },
        collect: function(prom_instance, labels, values) {
            let total_values = 0;
            for (const value of values) {
                total_values += value.semaphore_state.waiting_time;
            }
            prom_instance.set(labels, total_values / values.length);
            total_values = 0;
        },
    },
    {
        type: 'Gauge',
        name: 'semaphore_waiting_queue',
        configuration: {
            help: 'Namespace semaphore waiting queue size',
            labelNames: ['type', 'average_interval']
        },
        collect: function(prom_instance, labels, values) {
            let total_values = 0;
            for (const value of values) {
                total_values += value.semaphore_state.waiting_queue;
            }
            prom_instance.set(labels, total_values / values.length);
            total_values = 0;
        },
    },
    {
        type: 'Gauge',
        name: 'semaphore_value',
        configuration: {
            help: 'Namespace semaphore value',
            labelNames: ['type', 'average_interval']
        },
        collect(prom_instance, labels, values) {
            let total_values = 0;
            for (const value of values) {
                total_values += value.semaphore_state.value;
            }
            prom_instance.set(labels, total_values / values.length);
            total_values = 0;
        },
    },
    {
        type: 'Counter',
        name: 'fork_counter',
        configuration: {
            help: 'Counter on number of fork hit',
            labelNames: ['code']
        },
        aggregator: 'average',
    }
]);

class NooBaaEndpointReport extends BasePrometheusReport {
    constructor() {
        super();

        if (this.enabled) {
            this._metrics = {};
            for (const m of NOOBAA_ENDPOINT_METRICS) {
                this._metrics[m.name] = {
                    type: m.type,
                    collect: m.collect,
                    prom_instance: new this.prom_client[m.type]({
                        name: this.get_prefixed_name(m.name),
                        registers: [this.register],
                        ...m.configuration,
                        collect() {
                            if (m.collect && this.average_intervals) {
                                for (const average_interval of this.average_intervals) {
                                    if (this[average_interval]) {
                                        m.collect(this, this[average_interval].labels, this[average_interval].value);
                                    }
                                    if (this[average_interval + nsfs_suffix]) {
                                        m.collect(this, this[average_interval + nsfs_suffix].labels,
                                            this[average_interval + nsfs_suffix].value);
                                    }
                                }
                            }
                        }
                    }),
                };
            }
        }
    }

    // Increment counter metric
    inc(name, labels, value) {
        if (!this._metrics) return;
        const metric = this._metrics[name];
        if (!metric) throw new Error(`Unknown metric ${name}`);
        if (metric.type !== 'Counter') throw new Error(`Metric ${name} is not Counter`);
        metric.prom_instance.inc(labels, value);
    }

    // Set value metric
    set(name, labels, value, average_intervals) {
        if (!this._metrics) return;
        const metric = this._metrics[name];
        if (!metric) throw new Error(`Unknown metric ${name}`);
        if (metric.type !== 'Gauge') throw new Error(`Metric ${name} is not Gauge`);
        if (labels.type === 'object_io') {
            metric.prom_instance[labels.average_interval] = { labels, value };
        } else {
            // Adding suffix to distinguish between object_io and nsfs semaphore
            metric.prom_instance[labels.average_interval + nsfs_suffix] = { labels, value };
        }
        metric.prom_instance.average_intervals = average_intervals;
    }

    // Update histogram metric
    observe(name, labels, value) {
        if (!this._metrics) return;
        const metric = this._metrics[name];
        if (!metric) throw new Error(`Unknown metric ${name}`);
        if (metric.type !== 'Histogram') throw new Error(`Metric ${name} is not Histogram`);
        metric.prom_instance.observe(labels, value);
    }


    get metric_prefix() {
        return `${super.metric_prefix}Endpoint_`;
    }

    // Public interface to allow consuming code an interface for
    // setting/updating values for the various metrics, more complex
    // scenarios exists on the NooBaaCoreReport class
    set_metric1(data) {
        if (!this._metrics) return;

        this._metrics.metric_1.set(data);
    }
}

exports.NooBaaEndpointReport = NooBaaEndpointReport;
