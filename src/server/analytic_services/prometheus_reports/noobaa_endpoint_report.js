/* Copyright (C) 2016 NooBaa */
'use strict';

const { BasePrometheusReport } = require('./base_prometheus_report');
const js_utils = require('../../../util/js_utils');

// -----------------------------------------
// A report for collecting endpoint metrics,
// this class is a shim that should who ever
// come next to add endpoint metrics reporting.
// -----------------------------------------

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
                    prom_instance: new this.prom_client[m.type]({
                        name: this.get_prefixed_name(m.name),
                        registers: [this.registry],
                        ...m.configuration,
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
