/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const prom_client = require('prom-client');
const config = require('../../../config.js');

function get_metric_name(name) {
    return config.PROMETHEUS_PREFIX + name;
}

const METRIC_RECORDS = Object.freeze([{
    metric_type: 'Gauge',
    metric_variable: 'cloud_types',
    configuration: {
        name: get_metric_name('cloud_types'),
        help: 'Cloud Resource Types in the System',
        labelNames: ['type', 'count']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'unhealthy_cloud_types',
    configuration: {
        name: get_metric_name('unhealthy_cloud_types'),
        help: 'Unhealthy Cloud Resource Types in the System',
        labelNames: ['type', 'count']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'object_histo',
    configuration: {
        name: get_metric_name('object_histo'),
        help: 'Object Sizes Histogram Across the System',
        labelNames: ['size', 'avg', 'count']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'cloud_bandwidth',
    configuration: {
        name: get_metric_name('cloud_bandwidth'),
        help: 'Cloud bandwidth usage',
        labelNames: ['type', 'size']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'cloud_ops',
    configuration: {
        name: get_metric_name('cloud_ops'),
        help: 'Cloud number of operations',
        labelNames: ['type', 'number']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'system_capacity',
    configuration: {
        name: get_metric_name('system_capacity'),
        help: 'System capacity',
    },
    generate_default_set: true,
}, {
    metric_type: 'Gauge',
    metric_variable: 'system_name',
    configuration: {
        name: get_metric_name('system_name'),
        help: 'System name',
        labelNames: ['name']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'num_buckets',
    configuration: {
        name: get_metric_name('num_buckets'),
        help: 'Object Buckets',
    },
    generate_default_set: true,
}, {
    metric_type: 'Gauge',
    metric_variable: 'num_objects',
    configuration: {
        name: get_metric_name('num_objects'),
        help: 'Objects',
    },
    generate_default_set: true,
}, {
    metric_type: 'Gauge',
    metric_variable: 'num_unhealthy_buckets',
    configuration: {
        name: get_metric_name('num_unhealthy_buckets'),
        help: 'Unhealthy Buckets',
    },
    generate_default_set: true,
}, {
    metric_type: 'Gauge',
    metric_variable: 'num_buckets_claims',
    configuration: {
        name: get_metric_name('num_buckets_claims'),
        help: 'Object Bucket Claims',
    },
    generate_default_set: true,
}, {
    metric_type: 'Gauge',
    metric_variable: 'num_objects_buckets_claims',
    configuration: {
        name: get_metric_name('num_objects_buckets_claims'),
        help: 'Objects On Object Bucket Claims',
    },
    generate_default_set: true,
}]);


class PrometheusReporting {
    static instance() {
        PrometheusReporting._instance = PrometheusReporting._instance || new PrometheusReporting();
        return PrometheusReporting._instance;
    }

    constructor() {
        METRIC_RECORDS.filter(metric => metric.generate_default_set).forEach(metric => {
            this[`set_${metric.metric_variable}`] = function(data) {
                if (!this.enabled()) return;
                this._metrics[metric.metric_variable].set(data);
            };
        });
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

        //Currently called from stats_aggregator, md_aggregator and other stats collectors are probebly as interesting to look at
        METRIC_RECORDS.forEach(metric => {
            this._metrics[metric.metric_variable] = new prom_client[metric.metric_type](metric.configuration);
        });
    }

    export_metrics() {
        const exported = _.map(METRIC_RECORDS, metric =>
                this._prom_client.register.getSingleMetricAsString(metric.configuration.name))
            .join('\n');

        return exported;
    }

    set_cloud_types(types) {
        if (!this.enabled()) return;
        this._metrics.cloud_types.set({ type: 'AWS' }, types.cloud_pool_target.amazon);
        this._metrics.cloud_types.set({ type: 'Azure' }, types.cloud_pool_target.azure);
        this._metrics.cloud_types.set({ type: 'GCP' }, types.cloud_pool_target.gcp);
        // TODO: Fill this up when we will know how to recognize
        // this._metrics.cloud_types.set({ type: 'Ceph' }, types.cloud_pool_target.ceph);
        this._metrics.cloud_types.set({ type: 'S3_Compatible' }, types.cloud_pool_target.s3_comp);
    }

    set_unhealthy_cloud_types(types) {
        if (!this.enabled()) return;
        this._metrics.unhealthy_cloud_types.set({ type: 'AWS' }, types.unhealthy_cloud_pool_target.amazon_unhealthy);
        this._metrics.unhealthy_cloud_types.set({ type: 'Azure' }, types.unhealthy_cloud_pool_target.azure_unhealthy);
        this._metrics.unhealthy_cloud_types.set({ type: 'GCP' }, types.unhealthy_cloud_pool_target.gcp_unhealthy);
        // TODO: Fill this up when we will know how to recognize
        // this._metrics.unhealthy_cloud_types.set({ type: 'Ceph' }, types.unhealthy_cloud_pool_target.ceph_unhealthy);
        this._metrics.unhealthy_cloud_types.set({ type: 'S3_Compatible' }, types.unhealthy_cloud_pool_target.s3_comp_unhealthy);
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

    set_system_name(name) {
        if (!this.enabled()) return;
        this._metrics.system_name.set({ name }, 0);
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
