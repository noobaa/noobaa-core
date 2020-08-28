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
        labelNames: ['type']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'projects_capacity_usage',
    configuration: {
        name: get_metric_name('projects_capacity_usage'),
        help: 'Projects Capacity Usage',
        labelNames: ['project']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'accounts_usage_read_count',
    configuration: {
        name: get_metric_name('accounts_usage_read_count'),
        help: 'Accounts Usage Read Count',
        labelNames: ['account']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'accounts_usage_write_count',
    configuration: {
        name: get_metric_name('accounts_usage_write_count'),
        help: 'Accounts Usage Write Count',
        labelNames: ['account']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'accounts_usage_logical',
    configuration: {
        name: get_metric_name('accounts_usage_logical'),
        help: 'Accounts Usage Logical',
        labelNames: ['account']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'bucket_class_capacity_usage',
    configuration: {
        name: get_metric_name('bucket_class_capacity_usage'),
        help: 'Bucket Class Capacity Usage',
        labelNames: ['bucket_class']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'unhealthy_cloud_types',
    configuration: {
        name: get_metric_name('unhealthy_cloud_types'),
        help: 'Unhealthy Cloud Resource Types in the System',
        labelNames: ['type']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'object_histo',
    configuration: {
        name: get_metric_name('object_histo'),
        help: 'Object Sizes Histogram Across the System',
        labelNames: ['size', 'avg']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'providers_bandwidth_write_size',
    configuration: {
        name: get_metric_name('providers_bandwidth_write_size'),
        help: 'Providers bandwidth write size',
        labelNames: ['type']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'providers_bandwidth_read_size',
    configuration: {
        name: get_metric_name('providers_bandwidth_read_size'),
        help: 'Providers bandwidth read size',
        labelNames: ['type']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'providers_ops_read_num',
    configuration: {
        name: get_metric_name('providers_ops_read_num'),
        help: 'Providers number of read operations',
        labelNames: ['type']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'providers_ops_write_num',
    configuration: {
        name: get_metric_name('providers_ops_write_num'),
        help: 'Providers number of write operations',
        labelNames: ['type']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'providers_physical_size',
    configuration: {
        name: get_metric_name('providers_physical_size'),
        help: 'Providers Physical Stats',
        labelNames: ['type']
    }
}, {
    metric_type: 'Gauge',
    metric_variable: 'providers_logical_size',
    configuration: {
        name: get_metric_name('providers_logical_size'),
        help: 'Providers Logical Stats',
        labelNames: ['type']
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
        labelNames: ['system_name', 'system_address']
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
    metric_variable: 'object_savings_logical_size',
    configuration: {
        name: get_metric_name('object_savings_logical_size'),
        help: 'Object Savings Logical',
    },
    generate_default_set: true,
}, {
    metric_type: 'Gauge',
    metric_variable: 'object_savings_physical_size',
    configuration: {
        name: get_metric_name('object_savings_physical_size'),
        help: 'Object Savings Physical',
    },
    generate_default_set: true,
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
}, {
    metric_type: 'Gauge',
    metric_variable: 'bucket_healthy',
    configuration: {
        name: get_metric_name('bucket_status'),
        help: 'Bucket Health',
        labelNames: ['bucket_name'],
    },
}, {
    metric_type: 'Gauge',
    metric_variable: 'bucket_capacity_precent',
    configuration: {
        name: get_metric_name('bucket_capacity'),
        help: 'Bucket Capacity Precent',
        labelNames: ['bucket_name'],
    },
}, {
    metric_type: 'Gauge',
    metric_variable: 'bucket_quota_precent',
    configuration: {
        name: get_metric_name('bucket_quota'),
        help: 'Bucket Quota Precent',
        labelNames: ['bucket_name'],
    },
}, {
    metric_type: 'Gauge',
    metric_variable: 'resource_healthy',
    configuration: {
        name: get_metric_name('resource_status'),
        help: 'Resource Health',
        labelNames: ['resource_name'],
    },
}, {
    metric_type: 'Gauge',
    metric_variable: 'system_links',
    configuration: {
        name: get_metric_name('system_links'),
        help: 'System Links',
        labelNames: ['resources', 'buckets', 'dashboard'],
    },
}, {
    metric_type: 'Gauge',
    metric_variable: 'health_status',
    configuration: {
        name: get_metric_name('health_status'),
        help: 'Health status',
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
        this._metrics.cloud_types.set({ type: 'AWS' }, types.pool_target.amazon);
        this._metrics.cloud_types.set({ type: 'Azure' }, types.pool_target.azure);
        this._metrics.cloud_types.set({ type: 'GCP' }, types.pool_target.gcp);
        this._metrics.cloud_types.set({ type: 'Kubernetes' }, types.pool_target.kubernetes);
        // TODO: Fill this up when we will know how to recognize
        // this._metrics.cloud_types.set({ type: 'Ceph' }, types.pool_target.ceph);
        this._metrics.cloud_types.set({ type: 'S3_Compatible' }, types.pool_target.s3_comp);
    }

    set_unhealthy_cloud_types(types) {
        if (!this.enabled()) return;
        this._metrics.unhealthy_cloud_types.set({ type: 'AWS' }, types.unhealthy_pool_target.amazon_unhealthy);
        this._metrics.unhealthy_cloud_types.set({ type: 'Azure' }, types.unhealthy_pool_target.azure_unhealthy);
        this._metrics.unhealthy_cloud_types.set({ type: 'GCP' }, types.unhealthy_pool_target.gcp_unhealthy);
        this._metrics.unhealthy_cloud_types.set({ type: 'Kubernetes' }, types.unhealthy_pool_target.kubernetes_unhealthy);
        // TODO: Fill this up when we will know how to recognize
        // this._metrics.unhealthy_cloud_types.set({ type: 'Ceph' }, types.unhealthy_pool_target.ceph_unhealthy);
        this._metrics.unhealthy_cloud_types.set({ type: 'S3_Compatible' }, types.unhealthy_pool_target.s3_comp_unhealthy);
    }

    set_bucket_class_capacity_usage(usage_info) {
        if (!this.enabled()) return;
        this._metrics.bucket_class_capacity_usage.reset();
        for (let [bucket_class, value] of Object.entries(usage_info)) {
            this._metrics.bucket_class_capacity_usage.set({ bucket_class }, value);
        }
    }

    set_projects_capacity_usage(usage_info) {
        if (!this.enabled()) return;
        this._metrics.projects_capacity_usage.reset();
        for (let [project, value] of Object.entries(usage_info)) {
            this._metrics.projects_capacity_usage.set({ project }, value);
        }
    }

    set_accounts_io_usage(accounts_info) {
        if (!this.enabled()) return;
        this._metrics.accounts_usage_logical.reset();
        this._metrics.accounts_usage_read_count.reset();
        this._metrics.accounts_usage_write_count.reset();
        accounts_info.accounts.forEach(account_info => {
            const { account, read_count, write_count, read_write_bytes } = account_info;
            this._metrics.accounts_usage_logical.set({ account }, read_write_bytes);
            this._metrics.accounts_usage_read_count.set({ account }, read_count);
            this._metrics.accounts_usage_write_count.set({ account }, write_count);
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
        this._metrics.providers_bandwidth_read_size.set({ type }, read_size);
        this._metrics.providers_bandwidth_write_size.set({ type }, write_size);
    }

    set_providers_ops(type, write_num, read_num) {
        if (!this.enabled()) return;
        this._metrics.providers_ops_read_num.set({ type }, read_num);
        this._metrics.providers_ops_write_num.set({ type }, write_num);
    }

    set_providers_physical_logical(providers_stats) {
        if (!this.enabled()) return;
        for (let [type, value] of Object.entries(providers_stats)) {
            const { logical_size, physical_size } = value;
            this._metrics.providers_physical_size.set({ type }, physical_size);
            this._metrics.providers_logical_size.set({ type }, logical_size);
        }
    }

    set_system_info(info) {
        if (!this.enabled()) return;
        this._metrics.system_info.reset();
        this._metrics.system_info.set({ system_name: info.name, system_address: info.address }, Date.now());
    }

    set_system_links(links) {
        if (!this.enabled()) return;
        this._metrics.system_links.reset();
        this._metrics.system_links.set({ resources: links.resources, buckets: links.buckets, dashboard: links.dashboard }, Date.now());
    }

    set_bucket_status(buckets_info) {
        if (!this.enabled()) return;
        this._metrics.bucket_healthy.reset();
        this._metrics.bucket_quota_precent.reset();
        this._metrics.bucket_capacity_precent.reset();
        buckets_info.forEach(bucket_info => {
            this._metrics.bucket_healthy.set({ bucket_name: bucket_info.bucket_name }, Number(bucket_info.is_healthy));
            this._metrics.bucket_quota_precent.set({ bucket_name: bucket_info.bucket_name }, bucket_info.quota_precent);
            this._metrics.bucket_capacity_precent.set({ bucket_name: bucket_info.bucket_name }, bucket_info.capacity_precent);
        });
    }

    set_resource_status(resources_info) {
        if (!this.enabled()) return;
        this._metrics.resource_healthy.reset();
        resources_info.forEach(resource_info => {
            this._metrics.resource_healthy.set({ resource_name: resource_info.resource_name }, Number(resource_info.is_healthy));
        });
    }

    update_providers_bandwidth(type, write_size, read_size) {
        if (!this.enabled()) return;
        this._metrics.providers_bandwidth_read_size.inc({ type }, read_size);
        this._metrics.providers_bandwidth_write_size.inc({ type }, write_size);
    }

    update_providers_ops(type, write_num, read_num) {
        if (!this.enabled()) return;
        this._metrics.providers_ops_read_num.inc({ type }, read_num);
        this._metrics.providers_ops_write_num.inc({ type }, write_num);
    }
}

// EXPORTS
exports.PrometheusReporting = PrometheusReporting;
