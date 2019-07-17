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
    metric_variable: 'projects_capacity_usage',
    configuration: {
        name: get_metric_name('projects_capacity_usage'),
        help: 'Projects Capacity Usage',
        labelNames: ['project', 'count']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'accounts_io_usage',
    configuration: {
        name: get_metric_name('accounts_io_usage'),
        help: 'Accounts I/O Usage',
        labelNames: ['account', 'read_count', 'write_count']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'bucket_class_capacity_usage',
    configuration: {
        name: get_metric_name('bucket_class_capacity_usage'),
        help: 'Bucket Class Capacity Usage',
        labelNames: ['bucket_class', 'count']
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
    metric_variable: 'providers_bandwidth',
    configuration: {
        name: get_metric_name('providers_bandwidth'),
        help: 'Providers bandwidth usage',
        labelNames: ['type', 'io_size', 'size']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'providers_ops',
    configuration: {
        name: get_metric_name('providers_ops'),
        help: 'Providers number of operations',
        labelNames: ['type', 'io_ops', 'number']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'providers_physical_logical',
    configuration: {
        name: get_metric_name('providers_physical_logical'),
        help: 'Providers Physical And Logical Stats',
        labelNames: ['type', 'logical_size', 'physical_size']
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
    metric_variable: 'system_info',
    configuration: {
        name: get_metric_name('system_info'),
        help: 'System info',
        labelNames: ['system_name']
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
    metric_variable: 'total_usage',
    configuration: {
        name: get_metric_name('total_usage'),
        help: 'Total Usage',
    },
    generate_default_set: true,
}, {
    metric_type: 'Gauge',
    metric_variable: 'accounts_num',
    configuration: {
        name: get_metric_name('accounts_num'),
        help: 'Accounts Number',
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
    metric_variable: 'num_unhealthy_pools',
    configuration: {
        name: get_metric_name('num_unhealthy_pools'),
        help: 'Unhealthy Resource Pools',
    },
    generate_default_set: true,
}, {
    metric_type: 'Gauge',
    metric_variable: 'num_pools',
    configuration: {
        name: get_metric_name('num_pools'),
        help: 'Resource Pools',
    },
    generate_default_set: true,
}, {
    metric_type: 'Gauge',
    metric_variable: 'num_unhealthy_bucket_claims',
    configuration: {
        name: get_metric_name('num_unhealthy_bucket_claims'),
        help: 'Unhealthy Bucket Claims',
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
}, {
    metric_type: 'Gauge',
    metric_variable: 'reduction_ratio',
    configuration: {
        name: get_metric_name('reduction_ratio'),
        help: 'Object Efficiency Ratio',
    },
    generate_default_set: true,
}, {
    metric_type: 'Gauge',
    metric_variable: 'object_savings',
    configuration: {
        name: get_metric_name('object_savings'),
        help: 'Object Savings',
        labelNames: ['logical_size', 'physical_size'],
    },
}, {
    metric_type: 'Gauge',
    metric_variable: 'rebuild_progress',
    configuration: {
        name: get_metric_name('rebuild_progress'),
        help: 'Rebuild Progress',
    },
    generate_default_set: true,
}, {
    metric_type: 'Gauge',
    metric_variable: 'rebuild_time',
    configuration: {
        name: get_metric_name('rebuild_time'),
        help: 'Rebuild Time',
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

    set_bucket_class_capacity_usage(usage_info) {
        if (!this.enabled()) return;
        this._metrics.bucket_class_capacity_usage.reset();
        for (let [key, value] of Object.entries(usage_info)) {
            this._metrics.bucket_class_capacity_usage.set({ bucket_class: key }, value);
        }
    }

    set_projects_capacity_usage(usage_info) {
        if (!this.enabled()) return;
        this._metrics.projects_capacity_usage.reset();
        for (let [key, value] of Object.entries(usage_info)) {
            this._metrics.projects_capacity_usage.set({ project: key }, value);
        }
    }

    set_accounts_io_usage(accounts_info) {
        if (!this.enabled()) return;
        this._metrics.accounts_io_usage.reset();
        accounts_info.accounts.forEach(account_info => {
            const { account, read_count, write_count, read_write_bytes } = account_info;
            this._metrics.accounts_io_usage.set({ account, read_count, write_count }, read_write_bytes);
        });
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

    set_providers_bandwidth(type, write_size, read_size) {
        if (!this.enabled()) return;
        this._metrics.providers_bandwidth.set({ type: type, io_size: 'write_size' }, write_size);
        this._metrics.providers_bandwidth.set({ type: type, io_size: 'read_size' }, read_size);
    }

    set_providers_ops(type, write_num, read_num) {
        if (!this.enabled()) return;
        this._metrics.providers_ops.set({ type: type, io_ops: 'write_ops' }, write_num);
        this._metrics.providers_ops.set({ type: type, io_ops: 'read_ops' }, read_num);
    }

    set_object_savings(savings) {
        if (!this.enabled()) return;
        const { logical_size, physical_size } = savings;
        this._metrics.object_savings.set({ logical_size, physical_size }, logical_size - physical_size);
    }

    set_providers_physical_logical(providers_stats) {
        if (!this.enabled()) return;
        this._metrics.providers_physical_logical.reset();
        for (let [type, value] of Object.entries(providers_stats)) {
            const { logical_size, physical_size } = value;
            this._metrics.providers_physical_logical.set({ type, physical_size, logical_size }, Date.now());
        }
    }

    set_system_info(info) {
        if (!this.enabled()) return;
        this._metrics.system_info.set({ system_name: info.name }, 0);
    }

    update_providers_bandwidth(type, write_size, read_size) {
        if (!this.enabled()) return;
        this._metrics.providers_bandwidth.inc({ type: type, io_size: 'write_size' }, write_size, new Date());
        this._metrics.providers_bandwidth.inc({ type: type, io_size: 'read_size' }, read_size, new Date());
    }

    update_providers_ops(type, write_num, read_num) {
        if (!this.enabled()) return;
        this._metrics.providers_ops.inc({ type: type, io_ops: 'write_ops' }, write_num, new Date());
        this._metrics.providers_ops.inc({ type: type, io_ops: 'read_ops' }, read_num, new Date());
    }
}

// EXPORTS
exports.PrometheusReporting = PrometheusReporting;
