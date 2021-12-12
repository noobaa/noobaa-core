/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const { BasePrometheusReport } = require('./base_prometheus_report');
const dbg = require('../../../util/debug_module')(__filename);
const js_utils = require('../../../util/js_utils');

// -----------------------------------------
// Report for collecting noobaa core metrics
// Providing an interface to set/update said
// metrics
// -----------------------------------------
const NOOBAA_CORE_METRICS = js_utils.deep_freeze([{
        type: 'Gauge',
        name: 'cloud_types',
        configuration: {
            help: 'Cloud Resource Types in the System',
            labelNames: ['type']
        }
    }, {
        type: 'Gauge',
        name: 'projects_capacity_usage',
        configuration: {
            help: 'Projects Capacity Usage',
            labelNames: ['project']
        }
    }, {
        type: 'Gauge',
        name: 'accounts_usage_read_count',
        configuration: {
            help: 'Accounts Usage Read Count',
            labelNames: ['account']
        }
    }, {
        type: 'Gauge',
        name: 'accounts_usage_write_count',
        configuration: {
            help: 'Accounts Usage Write Count',
            labelNames: ['account']
        }
    }, {
        type: 'Gauge',
        name: 'accounts_usage_logical',
        configuration: {
            help: 'Accounts Usage Logical',
            labelNames: ['account']
        }
    }, {
        type: 'Gauge',
        name: 'bucket_class_capacity_usage',
        configuration: {
            help: 'Bucket Class Capacity Usage',
            labelNames: ['bucket_class']
        }
    }, {
        type: 'Gauge',
        name: 'unhealthy_cloud_types',
        configuration: {
            help: 'Unhealthy Cloud Resource Types in the System',
            labelNames: ['type']
        }
    }, {
        type: 'Gauge',
        name: 'object_histo',
        configuration: {
            help: 'Object Sizes Histogram Across the System',
            labelNames: ['size', 'avg']
        }
    }, {
        type: 'Gauge',
        name: 'providers_bandwidth_write_size',
        configuration: {
            help: 'Providers bandwidth write size',
            labelNames: ['type'],
        }
    }, {
        type: 'Gauge',
        name: 'providers_bandwidth_read_size',
        configuration: {
            help: 'Providers bandwidth read size',
            labelNames: ['type']
        }
    }, {
        type: 'Gauge',
        name: 'providers_ops_read_num',
        configuration: {
            help: 'Providers number of read operations',
            labelNames: ['type']
        }
    }, {
        type: 'Gauge',
        name: 'providers_ops_write_num',
        configuration: {
            help: 'Providers number of write operations',
            labelNames: ['type']
        }
    }, {
        type: 'Gauge',
        name: 'providers_physical_size',
        configuration: {
            help: 'Providers Physical Stats',
            labelNames: ['type']
        }
    }, {
        type: 'Gauge',
        name: 'providers_logical_size',
        configuration: {
            help: 'Providers Logical Stats',
            labelNames: ['type']
        }
    }, {
        type: 'Gauge',
        name: 'system_capacity',
        generate_default_set: true,
        configuration: {
            help: 'System capacity'
        }
    }, {
        type: 'Gauge',
        name: 'system_info',
        configuration: {
            help: 'System info',
            labelNames: ['system_name', 'system_address']
        }
    }, {
        type: 'Gauge',
        name: 'num_buckets',
        generate_default_set: true,
        configuration: {
            help: 'Object Buckets'
        }
    }, {
        type: 'Gauge',
        name: 'num_namespace_buckets',
        generate_default_set: true,
        configuration: {
            help: 'Namespace Buckets',
        },
    }, {
        type: 'Gauge',
        name: 'total_usage',
        generate_default_set: true,
        configuration: {
            help: 'Total Usage'
        }
    }, {
        type: 'Gauge',
        name: 'accounts_num',
        generate_default_set: true,
        configuration: {
            help: 'Accounts Number'
        }

    }, {
        type: 'Gauge',
        name: 'num_objects',
        generate_default_set: true,
        configuration: {
            help: 'Objects',
        }
    }, {
        type: 'Gauge',
        name: 'num_unhealthy_buckets',
        generate_default_set: true,
        configuration: {
            help: 'Unhealthy Buckets'
        }
    }, {
        type: 'Gauge',
        name: 'num_unhealthy_namespace_buckets',
        generate_default_set: true,
        configuration: {
            help: 'Unhealthy Namespace Buckets',
        },
    }, {
        type: 'Gauge',
        name: 'num_unhealthy_pools',
        generate_default_set: true,
        configuration: {
            help: 'Unhealthy Resource Pools'
        }
    }, {
        type: 'Gauge',
        name: 'num_unhealthy_namespace_resources',
        generate_default_set: true,
        configuration: {
            help: 'Unhealthy Namespace Resources'
        }
    }, {
        type: 'Gauge',
        name: 'num_pools',
        generate_default_set: true,
        configuration: {
            help: 'Resource Pools'
        }
    }, {
        type: 'Gauge',
        name: 'num_namespace_resources',
        generate_default_set: true,
        configuration: {
            help: 'Namespace Resources'
        }
    }, {
        type: 'Gauge',
        name: 'num_unhealthy_bucket_claims',
        generate_default_set: true,
        configuration: {
            help: 'Unhealthy Bucket Claims'
        }
    }, {
        type: 'Gauge',
        name: 'num_buckets_claims',
        generate_default_set: true,
        configuration: {
            help: 'Object Bucket Claims'
        }
    }, {
        type: 'Gauge',
        name: 'num_objects_buckets_claims',
        generate_default_set: true,
        configuration: {
            help: 'Objects On Object Bucket Claims'
        }
    }, {
        type: 'Gauge',
        name: 'reduction_ratio',
        generate_default_set: true,
        configuration: {
            help: 'Object Efficiency Ratio'
        }
    }, {
        type: 'Gauge',
        name: 'object_savings_logical_size',
        generate_default_set: true,
        configuration: {
            help: 'Object Savings Logical'
        }
    }, {
        type: 'Gauge',
        name: 'object_savings_physical_size',
        generate_default_set: true,
        configuration: {
            help: 'Object Savings Physical'
        }
    }, {
        type: 'Gauge',
        name: 'rebuild_progress',
        generate_default_set: true,
        configuration: {
            help: 'Rebuild Progress'
        }
    }, {
        type: 'Gauge',
        name: 'rebuild_time',
        generate_default_set: true,
        configuration: {
            help: 'Rebuild Time'
        }
    }, {
        type: 'Gauge',
        name: 'bucket_status',
        configuration: {
            help: 'Bucket Health',
            labelNames: ['bucket_name']
        }
    },
    {
        type: 'Gauge',
        name: 'namespace_bucket_status',
        configuration: {
            help: 'Namespace Bucket Health',
            labelNames: ['bucket_name'],
        },
    }, {
        type: 'Gauge',
        name: 'bucket_tagging',
        configuration: {
            help: 'Bucket Tagging',
            labelNames: ['bucket_name', 'tagging']
        }
    },
    {
        type: 'Gauge',
        name: 'namespace_bucket_tagging',
        configuration: {
            help: 'Namespace Bucket Tagging',
            labelNames: ['bucket_name', 'tagging']
        }
    }, {
        type: 'Gauge',
        name: 'bucket_capacity',
        configuration: {
            help: 'Bucket Capacity Precent',
            labelNames: ['bucket_name']
        }
    }, {
        type: 'Gauge',
        name: 'bucket_size_quota',
        configuration: {
            help: 'Bucket Size Quota Precent',
            labelNames: ['bucket_name']
        }
    }, {
        type: 'Gauge',
        name: 'bucket_quantity_quota',
        configuration: {
            help: 'Bucket Quantity Quota Precent',
            labelNames: ['bucket_name']
        }
    }, {
        type: 'Gauge',
        name: 'resource_status',
        configuration: {
            help: 'Resource Health',
            labelNames: ['resource_name']
        }
    }, {
        type: 'Gauge',
        name: 'namespace_resource_status',
        configuration: {
            help: 'Namespace Resource Health',
            labelNames: ['namespace_resource_name']
        }
    }, {
        type: 'Gauge',
        name: 'system_links',
        configuration: {
            help: 'System Links',
            labelNames: ['resources', 'buckets', 'dashboard']
        }
    }, {
        type: 'Gauge',
        name: 'health_status',
        generate_default_set: true,
        configuration: {
            help: 'Health status'
        }
    }, {
        type: 'Gauge',
        name: 'odf_health_status',
        generate_default_set: true,
        configuration: {
            help: 'Health status'
        }
    }, {
        type: 'Gauge',
        name: 'replication_status',
        configuration: {
            help: 'Replication status',
            labelNames: ['replication_id', 'bucket_name',
                'last_cycle_rule_id', 'last_cycle_src_cont_token'
            ]
        }
    }, {
        type: 'Gauge',
        name: 'replication_last_cycle_writes_size',
        configuration: {
            help: 'Number of bytes replicated by replication_id in last replication cycle',
            labelNames: ['replication_id']
        }
    },
    {
        type: 'Gauge',
        name: 'replication_last_cycle_writes_num',
        configuration: {
            help: 'Number of objects replicated by replication_id in last replication cycle',
            labelNames: ['replication_id']
        }
    },
    {
        type: 'Gauge',
        name: 'replication_last_cycle_error_writes_size',
        configuration: {
            help: 'Number of error bytes replication_id in last replication cycle',
            labelNames: ['replication_id']
        }
    }, {
        type: 'Gauge',
        name: 'replication_last_cycle_error_writes_num',
        configuration: {
            help: 'Number of error objects replication_id in last replication cycle',
            labelNames: ['replication_id']
        }
    }
]);

class NooBaaCoreReport extends BasePrometheusReport {
    constructor() {
        super();

        this._metrics = null;

        if (this.enabled) {
            this._metrics = {};
            for (const m of NOOBAA_CORE_METRICS) {
                if (!m.type && !this.prom_client[m.type]) {
                    dbg.warn(`noobaa_core_report - Metric ${m.name} has an unknown type`);
                    continue;
                }
                this._metrics[m.name] = new this.prom_client[m.type]({
                    name: this.get_prefixed_name(m.name),
                    registers: [this.registry],
                    ...m.configuration,
                });
            }
        }

        // It is important to move the name into a local var
        // in order to prevent the closure from capturing the entire
        // metric definition
        for (const { generate_default_set, name } of NOOBAA_CORE_METRICS) {
            if (generate_default_set) {
                // Create a default setter.
                this[`set_${name}`] = data => {
                    if (!this._metrics) return;
                    this._metrics[name].set(data);
                };
            }
        }
    }

    set_cloud_types(types) {
        if (!this._metrics) return;

        this._metrics.cloud_types.set({ type: 'AWS' }, types.pool_target.amazon);
        this._metrics.cloud_types.set({ type: 'Azure' }, types.pool_target.azure);
        this._metrics.cloud_types.set({ type: 'GCP' }, types.pool_target.gcp);
        this._metrics.cloud_types.set({ type: 'Kubernetes' }, types.pool_target.kubernetes);
        // TODO: Fill this up when we will know how to recognize
        // this._metrics.cloud_types.set({ type: 'Ceph' }, types.pool_target.ceph);
        this._metrics.cloud_types.set({ type: 'S3_Compatible' }, types.pool_target.s3_comp);
    }

    set_unhealthy_cloud_types(types) {
        if (!this._metrics) return;

        this._metrics.unhealthy_cloud_types.set({ type: 'AWS' }, types.unhealthy_pool_target.amazon_unhealthy);
        this._metrics.unhealthy_cloud_types.set({ type: 'Azure' }, types.unhealthy_pool_target.azure_unhealthy);
        this._metrics.unhealthy_cloud_types.set({ type: 'GCP' }, types.unhealthy_pool_target.gcp_unhealthy);
        this._metrics.unhealthy_cloud_types.set({ type: 'Kubernetes' }, types.unhealthy_pool_target.kubernetes_unhealthy);
        // TODO: Fill this up when we will know how to recognize
        // this._metrics.unhealthy_cloud_types.set({ type: 'Ceph' }, types.unhealthy_pool_target.ceph_unhealthy);
        this._metrics.unhealthy_cloud_types.set({ type: 'S3_Compatible' }, types.unhealthy_pool_target.s3_comp_unhealthy);
    }

    set_bucket_class_capacity_usage(usage_info) {
        if (!this._metrics) return;

        this._metrics.bucket_class_capacity_usage.reset();
        for (const [bucket_class, value] of Object.entries(usage_info)) {
            this._metrics.bucket_class_capacity_usage.set({ bucket_class }, value);
        }
    }

    set_projects_capacity_usage(usage_info) {
        if (!this._metrics) return;

        this._metrics.projects_capacity_usage.reset();
        for (const [project, value] of Object.entries(usage_info)) {
            this._metrics.projects_capacity_usage.set({ project }, value);
        }
    }

    set_accounts_io_usage(accounts_info) {
        if (!this._metrics) return;

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
        if (!this._metrics) return;

        for (const bin of sizes) {
            if (!_.isEmpty(bin.bins)) {
                for (const cur of bin.bins) {
                    this._metrics.object_histo.set({ size: cur.label, avg: cur.avg }, cur.count, new Date());
                }
            }
        }
    }

    set_providers_bandwidth(type, write_size, read_size) {
        if (!this._metrics) return;

        this._metrics.providers_bandwidth_read_size.set({ type }, read_size);
        this._metrics.providers_bandwidth_write_size.set({ type }, write_size);
    }

    set_providers_ops(type, write_num, read_num) {
        if (!this._metrics) return;

        this._metrics.providers_ops_read_num.set({ type }, read_num);
        this._metrics.providers_ops_write_num.set({ type }, write_num);
    }

    set_providers_physical_logical(providers_stats) {
        if (!this._metrics) return;

        for (let [type, value] of Object.entries(providers_stats)) {
            const { logical_size, physical_size } = value;
            this._metrics.providers_physical_size.set({ type }, physical_size);
            this._metrics.providers_logical_size.set({ type }, logical_size);
        }
    }

    set_system_info(info) {
        if (!this._metrics) return;

        this._metrics.system_info.reset();
        this._metrics.system_info.set({ system_name: info.name, system_address: info.address }, Date.now());
    }

    set_system_links(links) {
        if (!this._metrics) return;

        this._metrics.system_links.reset();
        this._metrics.system_links.set({ resources: links.resources, buckets: links.buckets, dashboard: links.dashboard }, Date.now());
    }

    set_bucket_status(buckets_info) {
        if (!this._metrics) return;

        this._metrics.bucket_status.reset();
        this._metrics.bucket_size_quota.reset();
        this._metrics.bucket_quantity_quota.reset();
        this._metrics.bucket_capacity.reset();
        this._metrics.bucket_tagging.reset();
        buckets_info.forEach(bucket_info => {
            const bucket_labels = { bucket_name: bucket_info.bucket_name };
            if (bucket_info.tagging && bucket_info.tagging.length) {
                const tagging = bucket_info.tagging.map(tag => `{ ${tag.key} : ${tag.value} }`);
                this._metrics.bucket_tagging.set({ ...bucket_labels, tagging }, Date.now());
            }
            this._metrics.bucket_status.set(bucket_labels, Number(bucket_info.is_healthy));
            this._metrics.bucket_size_quota.set({ bucket_name: bucket_info.bucket_name }, bucket_info.quota_size_precent);
            this._metrics.bucket_quantity_quota.set({ bucket_name: bucket_info.bucket_name }, bucket_info.quota_quantity_percent);
            this._metrics.bucket_capacity.set({ bucket_name: bucket_info.bucket_name }, bucket_info.capacity_precent);

        });
    }

    set_namespace_bucket_status(buckets_info) {
        if (!this._metrics) return;
        this._metrics.namespace_bucket_status.reset();
        this._metrics.namespace_bucket_tagging.reset();
        buckets_info.forEach(bucket_info => {
            const bucket_labels = { bucket_name: bucket_info.bucket_name };
            if (bucket_info.tagging && bucket_info.tagging.length) {
                const tagging = bucket_info.tagging.map(tag => `{ ${tag.key} : ${tag.value} }`);
                this._metrics.namespace_bucket_tagging.set({ ...bucket_labels, tagging }, Date.now());
            }
            this._metrics.namespace_bucket_status.set(bucket_labels, Number(bucket_info.is_healthy));
        });
    }

    set_resource_status(resources_info) {
        if (!this._metrics) return;

        this._metrics.resource_status.reset();
        resources_info.forEach(resource_info => {
            this._metrics.resource_status.set({ resource_name: resource_info.resource_name }, Number(resource_info.is_healthy));
        });
    }

    set_namespace_resource_status(namespace_resources_info) {
        if (!this._metrics) return;

        this._metrics.namespace_resource_status.reset();
        namespace_resources_info.forEach(namespace_resource_info => {
            this._metrics.namespace_resource_status.set({ namespace_resource_name: namespace_resource_info.namespace_resource_name },
                Number(namespace_resource_info.is_healthy));
        });
    }

    update_providers_bandwidth(type, write_size, read_size) {
        if (!this._metrics) return;

        this._metrics.providers_bandwidth_read_size.inc({ type }, read_size);
        this._metrics.providers_bandwidth_write_size.inc({ type }, write_size);
    }

    update_providers_ops(type, write_num, read_num) {
        if (!this._metrics) return;

        this._metrics.providers_ops_read_num.inc({ type }, read_num);
        this._metrics.providers_ops_write_num.inc({ type }, write_num);
    }

    set_replication_status(repl_info) {
        if (!this._metrics) return;
        const replication_id = repl_info.replication_id;
        delete this._metrics.replication_status.hashMap[String(repl_info.replication_id)];
        this._metrics.replication_status.set(_.omit(repl_info, ['last_cycle_writes_size',
            'last_cycle_writes_num', 'last_cycle_error_writes_size', 'last_cycle_error_writes_num'
        ]), Date.now());

        delete this._metrics.replication_last_cycle_writes_size.hashMap[String(repl_info.replication_id)];
        this._metrics.replication_last_cycle_writes_size.set({ replication_id }, repl_info.last_cycle_writes_size);

        delete this._metrics.replication_last_cycle_writes_num.hashMap[String(repl_info.replication_id)];
        this._metrics.replication_last_cycle_writes_num.set({ replication_id }, repl_info.last_cycle_writes_num);

        delete this._metrics.replication_last_cycle_error_writes_size.hashMap[String(repl_info.replication_id)];
        this._metrics.replication_last_cycle_error_writes_size.set({ replication_id }, repl_info.last_cycle_error_writes_size);

        delete this._metrics.replication_last_cycle_error_writes_num.hashMap[String(repl_info.replication_id)];
        this._metrics.replication_last_cycle_error_writes_num.set({ replication_id }, repl_info.last_cycle_error_writes_num);
    }
}

exports.NooBaaCoreReport = NooBaaCoreReport;
