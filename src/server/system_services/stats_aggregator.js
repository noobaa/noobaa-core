/* Copyright (C) 2016 NooBaa */
/**
 *
 * STATS_AGGREGATOR
 *
 */
'use strict';
const DEV_MODE = (process.env.DEV_MODE === 'true');
const _ = require('lodash');
const fs = require('fs');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const Histogram = require('../../util/histogram');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const system_server = require('../system_services/system_server');
const bucket_server = require('../system_services/bucket_server');
const account_server = require('../system_services/account_server');
const object_server = require('../object_services/object_server');
const auth_server = require('../common_services/auth_server');
const server_rpc = require('../server_rpc');
const size_utils = require('../../util/size_utils');
const net_utils = require('../../util/net_utils');
const fs_utils = require('../../util/fs_utils');
const Dispatcher = require('../notifications/dispatcher');
const prom_reporting = require('../analytic_services/prometheus_reporting');
const { HistoryDataStore } = require('../analytic_services/history_data_store');
const addr_utils = require('../../util/addr_utils');
const Quota = require('../system_services/objects/quota');


const ops_aggregation = {};
const SCALE_BYTES_TO_GB = 1024 * 1024 * 1024;
const SCALE_SEC_TO_DAYS = 60 * 60 * 24;

const ALERT_LOW_TRESHOLD = 10;
const ALERT_HIGH_TRESHOLD = 20;

// This value is non persistent on process restarts
// This means that there might be a situation when we won't get phone home data
// If the process will always crash prior to reaching the required amount of cycles (full_cycle_ratio)
// Also in case of failures with sending the phone home we won't perform the partial cycles
// TODO: Maybe add some sort of a timeout mechanism to the failures in order to perform partial cycles?
let current_cycle = 0;
let last_partial_stats_requested = 0;
const PARTIAL_STATS_REQUESTED_GRACE_TIME = 30 * 1000;

// Will hold the nsfs counters/metrics
let nsfs_io_counters = _new_nsfs_stats();
// Will hold the op stats (op name, min/max/avg time, count, error count)
let op_stats = {};
let fs_workers_stats = {};

/*
 * Stats Collction API
 */
const SYSTEM_STATS_DEFAULTS = {
    clusterid: '',
    version: '',
    agent_version: '',
    version_history: [],
    count: 0,
    systems: [],
};

const SYS_STORAGE_DEFAULTS = Object.freeze({
    total: 0,
    free: 0,
    unavailable_free: 0,
    alloc: 0,
    real: 0,
});

const SINGLE_SYS_DEFAULTS = {
    tiers: 0,
    buckets: 0,
    chunks: 0,
    // chunks_rebuilt_since_last: 0,
    objects: 0,
    roles: 0,
    allocated_space: 0,
    used_space: 0,
    total_space: 0,
    owner: '',
    associated_nodes: {
        on: 0,
        off: 0,
    },
    configuration: {
        dns_servers: 0,
        dns_name: false,
    },
    cluster: {
        members: 0
    }
};

const PARTIAL_BUCKETS_STATS_DEFAULTS = {
    buckets: [],
    buckets_num: 0,
    objects_in_buckets: 0,
    unhealthy_buckets: 0,
    bucket_claims: 0,
    objects_in_bucket_claims: 0,
    unhealthy_bucket_claims: 0,
};

const PARTIAL_NAMESPACE_BUCKETS_STATS_DEFAULTS = {
    namespace_buckets: [],
    namespace_buckets_num: 0,
    unhealthy_namespace_buckets: 0,
};

const PARTIAL_SYSTEM_STATS_DEFAULTS = {
    systems: [],
};

const PARTIAL_ACCOUNT_IO_STATS = {
    accounts: [],
    accounts_num: 0,
};

const PARTIAL_SINGLE_ACCOUNT_DEFAULTS = {
    account: '',
    read_count: 0,
    write_count: 0,
    read_write_bytes: 0,
};

const PARTIAL_SINGLE_SYS_DEFAULTS = {
    name: '',
    address: '',
    links: {
        resources: '',
        dashboard: '',
        buckets: '',
    },
    capacity: 0,
    reduction_ratio: 0,
    savings: {
        logical_size: 0,
        physical_size: 0,
    },
    buckets_stats: PARTIAL_BUCKETS_STATS_DEFAULTS,
    namespace_buckets_stats: PARTIAL_NAMESPACE_BUCKETS_STATS_DEFAULTS,
    usage_by_project: {
        'Cluster-wide': 0,
    },
    usage_by_bucket_class: {
        'Cluster-wide': 0,
    },
};



//Aggregate bucket configuration and policies
function _aggregate_buckets_config(system) {
    let bucket_config = [];
    const sorted_1k_buckets = system.buckets
        .sort((bucket_a, bucket_b) => bucket_b.num_objects.value - bucket_a.num_objects.value)
        .slice(0, 1000);

    for (const cbucket of sorted_1k_buckets) {
        let current_config = {};
        current_config.num_objects = cbucket.num_objects.value;
        current_config.versioning = cbucket.versioning;
        current_config.quota = Boolean(cbucket.quota);
        current_config.tiers = [];
        if (cbucket.tiering) {
            for (const ctier of cbucket.tiering.tiers) {
                let current_tier = _.find(system.tiers, t => ctier.tier === t.name);
                if (current_tier) {
                    current_config.tiers.push({
                        placement_type: current_tier.data_placement,
                        mirrors: current_tier.mirror_groups.length,
                        // spillover_enabled: Boolean(ctier.spillover && !ctier.disabled),
                        replicas: current_tier.chunk_coder_config.replicas,
                        data_frags: current_tier.chunk_coder_config.data_frags,
                        parity_frags: current_tier.chunk_coder_config.parity_frags,
                    });
                }
            }
        }
        bucket_config.push(current_config);
    }
    return bucket_config;
}

//Collect systems related stats and usage
async function get_systems_stats(req) {
    var sys_stats = _.cloneDeep(SYSTEM_STATS_DEFAULTS);
    sys_stats.agent_version = process.env.AGENT_VERSION || 'Unknown';
    sys_stats.count = system_store.data.systems.length;
    sys_stats.os_release = (await fs.promises.readFile('/etc/redhat-release').catch(fs_utils.ignore_enoent) || 'unkonwn').toString();
    sys_stats.platform = process.env.PLATFORM;
    var cluster = system_store.data.clusters[0];
    if (cluster && cluster.cluster_id) {
        sys_stats.clusterid = cluster.cluster_id;
    }

    try {
        sys_stats.systems = await P.all(_.map(system_store.data.systems, async system => {
            const new_req = _.defaults({
                system: system
            }, req);

            const res = await system_server.read_system(new_req);
            // Means that if we do not have any systems, the version number won't be sent
            sys_stats.version = res.version || process.env.CURRENT_VERSION;
            const buckets_config = _aggregate_buckets_config(res);
            const has_dns_name = system.system_address.some(addr =>
                addr.api === 'mgmt' && !net_utils.is_ip(addr.hostnames)
            );

            return _.defaults({
                roles: res.roles.length,
                tiers: res.tiers.length,
                buckets: res.buckets.length,
                buckets_config: buckets_config,
                objects: res.objects,
                allocated_space: res.storage.alloc,
                used_space: res.storage.used,
                total_space: res.storage.total,
                free_space: res.storage.free,
                associated_nodes: {
                    on: res.nodes.online,
                    off: res.nodes.count - res.nodes.online,
                },
                owner: res.owner.email,
                configuration: {
                    dns_servers: res.cluster.shards[0].servers[0].dns_servers.length,
                    dns_name: has_dns_name,
                },
                cluster: {
                    members: res.cluster.shards[0].servers.length
                },
            }, SINGLE_SYS_DEFAULTS);
        }));

        sys_stats.version_history = await HistoryDataStore.instance().get_system_version_history();

        return sys_stats;
    } catch (err) {
        dbg.warn('Error in collecting systems stats,',
            'skipping current sampling point', err.stack || err);
        throw err;
    }
}

async function get_partial_accounts_stats(req) {
    const accounts_stats = _.cloneDeep(PARTIAL_ACCOUNT_IO_STATS);
    try {
        // TODO: Either make a large query or per account
        // In case of large query we also need to set a limit and tirgger listing queries so we won't crash
        const now = Date.now();
        accounts_stats.accounts = await P.all(_.compact(_.map(system_store.data.accounts, async account => {
            if (account.is_support) return;
            accounts_stats.accounts_num += 1;
            const new_req = _.defaults({
                rpc_params: { accounts: [account.email], since: config.NOOBAA_EPOCH, till: now },
            }, req);

            const account_usage_info = await account_server.get_account_usage(new_req);
            if (_.isEmpty(account_usage_info)) return;

            const { read_count, write_count } = account_usage_info[0];
            const read_bytes = size_utils.json_to_bigint(account_usage_info[0].read_bytes || size_utils.BigInteger.zero);
            const write_bytes = size_utils.json_to_bigint(account_usage_info[0].write_bytes || size_utils.BigInteger.zero);
            const read_write_bytes = read_bytes.plus(write_bytes).toJSNumber();
            return _.defaults({
                account: account.email.unwrap(),
                read_count,
                write_count,
                read_write_bytes,
            }, PARTIAL_SINGLE_ACCOUNT_DEFAULTS);
        })));
        accounts_stats.accounts = _.compact(accounts_stats.accounts);
        return accounts_stats;
    } catch (err) {
        dbg.warn('Error in collecting partial account i/o stats,',
            'skipping current sampling point', err.stack || err);
        throw err;
    }
}


async function get_partial_providers_stats(req) {
    const provider_stats = {};
    const supported_cloud_types = [
        'AWS',
        'AWSSTS',
        'AZURE',
        'S3_COMPATIBLE',
        'GOOGLE',
    ];
    try {
        for (const bucket of system_store.data.buckets) {
            if (!bucket.storage_stats) continue;
            if (bucket.deleting) continue;
            const { pools, objects_size } = bucket.storage_stats;
            const types_mapped = new Map();
            for (let [key, value] of Object.entries(pools)) {
                const pool = system_store.data.pools.find(pool_rec => String(pool_rec._id) === String(key));
                // TODO: Handle deleted pools
                if (!pool) continue;
                if (pool.mongo_pool_info) continue;
                let type = 'KUBERNETES';
                if (pool.cloud_pool_info) {
                    type = (supported_cloud_types.includes(pool.cloud_pool_info.endpoint_type)) ?
                        pool.cloud_pool_info.endpoint_type : 'OTHERS';
                }
                if (!provider_stats[type]) {
                    provider_stats[type] = {
                        logical_size: 0,
                        physical_size: 0,
                    };
                }
                provider_stats[type].logical_size =
                    size_utils.json_to_bigint(provider_stats[type].logical_size)
                    .plus(size_utils.json_to_bigint(objects_size))
                    .toJSNumber();
                if (!types_mapped.has(type)) {
                    provider_stats[type].physical_size =
                        size_utils.json_to_bigint(provider_stats[type].physical_size)
                        .plus(size_utils.json_to_bigint(value.blocks_size))
                        .toJSNumber();
                }
                // Marking that we shouldn't add logical_size more than once for this type
                types_mapped.set(type, 1);
            }
        }
        return provider_stats;
    } catch (err) {
        dbg.warn('Error in collecting partial providers stats,',
            'skipping current sampling point', err.stack || err);
        throw err;
    }
}


async function get_partial_systems_stats(req) {
    const sys_stats = _.cloneDeep(PARTIAL_SYSTEM_STATS_DEFAULTS);
    try {
        sys_stats.systems = await P.all(_.map(system_store.data.systems, async system => {
            const new_req = _.defaults({
                system: system
            }, req);

            const {
                buckets_stats,
                namespace_buckets_stats,
                objects_sys,
                objects_non_namespace_buckets_sys,
                usage_by_bucket_class,
                usage_by_project,
            } = await _partial_buckets_info(new_req);

            // nodes - count, online count, allocated/used storage aggregate by pool
            const nodes_aggregate_pool_with_cloud_no_mongo = await nodes_client.instance()
                .aggregate_nodes_by_pool(null, system._id, /*skip_cloud_nodes=*/ false, /*skip_mongo_nodes=*/ true);

            const storage = size_utils.to_bigint_storage(_.defaults({
                used: objects_sys.size,
            }, nodes_aggregate_pool_with_cloud_no_mongo.storage, SYS_STORAGE_DEFAULTS));

            const { chunks_capacity, logical_size } = objects_non_namespace_buckets_sys;
            const chunks = size_utils.bigint_to_bytes(chunks_capacity);
            const logical = size_utils.bigint_to_bytes(logical_size);
            const reduction_ratio = (logical / chunks) || 1;
            const savings = {
                logical_size: logical_size.toJSNumber(),
                physical_size: chunks_capacity.toJSNumber(),
            };
            const free_bytes = size_utils.bigint_to_bytes(storage.free);
            const total_bytes = size_utils.bigint_to_bytes(storage.total);
            const total_usage = size_utils.bigint_to_bytes(storage.used);
            const capacity = 100 - Math.floor(((free_bytes / total_bytes) || 1) * 100);

            const { system_address } = system;
            const https_port = process.env.SSL_PORT || 5443;
            const address = DEV_MODE ? `https://localhost:${https_port}/` : addr_utils.get_base_address(system_address, {
                hint: 'EXTERNAL',
                protocol: 'https'
            }).toString();

            // TODO: Attempted to dynamically build from routes.js in the FE.
            // There is a problem that we do not pack the source code and only the dist.
            const links = {
                buckets: address.concat(`fe/systems/${system.name}/buckets/data-buckets`),
                resources: address.concat(`fe/systems/${system.name}/resources/storage`),
                dashboard: address.concat(`fe/systems/${system.name}`),
            };

            return _.defaults({
                name: system.name,
                address,
                capacity,
                links,
                reduction_ratio,
                savings,
                total_usage,
                buckets_stats,
                namespace_buckets_stats,
                usage_by_bucket_class,
                usage_by_project,
            }, PARTIAL_SINGLE_SYS_DEFAULTS);
        }));
        return sys_stats;
    } catch (err) {
        dbg.warn('Error in collecting partial systems stats,',
            'skipping current sampling point', err.stack || err);
        throw err;
    }
}


async function _partial_buckets_info(req) {
    const buckets_stats = _.cloneDeep(PARTIAL_BUCKETS_STATS_DEFAULTS);
    const namespace_buckets_stats = _.cloneDeep(PARTIAL_NAMESPACE_BUCKETS_STATS_DEFAULTS);
    const objects_sys = {
        size: size_utils.BigInteger.zero,
        count: 0,
    };
    const objects_non_namespace_buckets_sys = {
        chunks_capacity: size_utils.BigInteger.zero,
        logical_size: size_utils.BigInteger.zero,
    };
    const usage_by_project = {
        'Cluster-wide': size_utils.BigInteger.zero,
    };
    const usage_by_bucket_class = {
        'Cluster-wide': size_utils.BigInteger.zero,
    };

    try {
        for (const bucket of system_store.data.buckets) {
            if (String(bucket.system._id) !== String(req.system._id)) continue;
            if (bucket.deleting) continue;
            const new_req = _.defaults({
                rpc_params: { name: bucket.name, },
            }, req);

            const bucket_info = await bucket_server.read_bucket(new_req);

            objects_sys.size = objects_sys.size.plus(
                (bucket.storage_stats && size_utils.json_to_bigint(bucket.storage_stats.objects_size)) || 0
            );
            objects_sys.count += bucket_info.num_objects.value || 0;

            const OPTIMAL_MODES = [
                'LOW_CAPACITY',
                'DATA_ACTIVITY',
                'OPTIMAL',
            ];

            const CAPACITY_MODES = [
                'OPTIMAL',
                'NO_RESOURCES_INTERNAL',
                'DATA_ACTIVITY',
                'APPROUCHING_QUOTA',
                'TIER_LOW_CAPACITY',
                'LOW_CAPACITY',
                'TIER_NO_CAPACITY',
                'EXCEEDING_QUOTA',
                'NO_CAPACITY',
            ];

            if (bucket_info.namespace) {
                namespace_buckets_stats.namespace_buckets_num += 1;
                const ns_bucket_mode_optimal = bucket_info.mode === 'OPTIMAL';
                namespace_buckets_stats.namespace_buckets.push({
                    bucket_name: bucket_info.name.unwrap(),
                    is_healthy: ns_bucket_mode_optimal,
                    tagging: bucket_info.tagging || []
                });
                if (!ns_bucket_mode_optimal) namespace_buckets_stats.unhealthy_namespace_buckets += 1;
                continue;
            }
            objects_non_namespace_buckets_sys.chunks_capacity = objects_non_namespace_buckets_sys.chunks_capacity.plus(
                (bucket.storage_stats && size_utils.json_to_bigint(bucket.storage_stats.chunks_capacity)) || 0
            );

            objects_non_namespace_buckets_sys.logical_size = objects_non_namespace_buckets_sys.logical_size.plus(
                (bucket.storage_stats && size_utils.json_to_bigint(bucket.storage_stats.objects_size)) || 0
            );

            const bucket_project = (bucket_info.bucket_claim && bucket_info.bucket_claim.namespace) || 'Cluster-wide';
            const existing_project = usage_by_project[bucket_project] || size_utils.BigInteger.zero;
            usage_by_project[bucket_project] = existing_project.plus(
                (bucket.storage_stats && size_utils.json_to_bigint(bucket.storage_stats.objects_size)) || 0
            );
            const bucket_class = (bucket_info.bucket_claim && bucket_info.bucket_claim.bucket_class) || 'Cluster-wide';
            const existing_bucket_class = usage_by_bucket_class[bucket_class] || size_utils.BigInteger.zero;
            usage_by_bucket_class[bucket_class] = existing_bucket_class.plus(
                (bucket.storage_stats && size_utils.json_to_bigint(bucket.storage_stats.objects_size)) || 0
            );

            if (bucket_info.bucket_claim) {
                buckets_stats.bucket_claims += 1;
                buckets_stats.objects_in_bucket_claims += bucket_info.num_objects.value;
                if (!_.includes(OPTIMAL_MODES, bucket_info.mode)) buckets_stats.unhealthy_bucket_claims += 1;
            } else {
                buckets_stats.buckets_num += 1;
                buckets_stats.objects_in_buckets += bucket_info.num_objects.value;
                if (!_.includes(OPTIMAL_MODES, bucket_info.mode)) buckets_stats.unhealthy_buckets += 1;
            }

            const bucket_used = bucket.storage_stats && size_utils.json_to_bigint(bucket.storage_stats.objects_size);
            const bucket_available = size_utils.json_to_bigint(_.get(bucket_info, 'data.free') || 0);
            const bucket_total = bucket_used.plus(bucket_available);
            const is_capacity_relevant = _.includes(CAPACITY_MODES, bucket_info.mode);
            const { size_used_percent, quantity_used_percent } = new Quota(bucket.quota).get_bucket_quota_usages_percent(bucket);
            buckets_stats.buckets.push({
                bucket_name: bucket_info.name.unwrap(),
                quota_size_precent: size_used_percent,
                quota_quantity_percent: quantity_used_percent,
                capacity_precent: (is_capacity_relevant && bucket_total > 0) ? size_utils.bigint_to_json(bucket_used.multiply(100)
                    .divide(bucket_total)) : 0,
                is_healthy: _.includes(OPTIMAL_MODES, bucket_info.mode),
                tagging: bucket_info.tagging || []
            });
        }

        Object.keys(usage_by_bucket_class).forEach(key => {
            usage_by_bucket_class[key] = usage_by_bucket_class[key].toJSNumber();
        });
        Object.keys(usage_by_project).forEach(key => {
            usage_by_project[key] = usage_by_project[key].toJSNumber();
        });

        return {
            buckets_stats,
            objects_sys,
            objects_non_namespace_buckets_sys,
            usage_by_project,
            usage_by_bucket_class,
            namespace_buckets_stats
        };
    } catch (err) {
        dbg.warn('Error in collecting partial buckets stats,',
            'skipping current sampling point', err.stack || err);
        throw err;
    }
}


var NODES_STATS_DEFAULTS = {
    count: 0,
    hosts_count: 0,
    os: {},
    nodes_with_issue: 0
};

const CLOUD_POOL_STATS_DEFAULTS = {
    pool_count: 0,
    unhealthy_pool_count: 0,
    cloud_pool_count: 0,
    pool_target: {
        amazon: 0,
        azure: 0,
        gcp: 0,
        s3_comp: 0,
        kubernetes: 0,
        other: 0,
    },
    unhealthy_pool_target: {
        amazon_unhealthy: 0,
        azure_unhealthy: 0,
        gcp_unhealthy: 0,
        s3_comp_unhealthy: 0,
        kubernetes_unhealthy: 0,
        other_unhealthy: 0,
    },
    compatible_auth_type: {
        v2: 0,
        v4: 0,
    },
    resources: []
};

const NAMESPACE_RESOURCE_STATS_DEFAULTS = {
    namespace_resource_count: 0,
    unhealthy_namespace_resource_count: 0,
    namespace_resources: []
};

//Collect nodes related stats and usage
function get_nodes_stats(req) {
    var nodes_stats = _.cloneDeep(NODES_STATS_DEFAULTS);
    var nodes_histo = get_empty_nodes_histo();
    //Per each system fill out the needed info
    const system = system_store.data.systems[0];
    const support_account = _.find(system_store.data.accounts, account => account.is_support);

    return Promise.all([
            server_rpc.client.node.list_nodes({}, {
                auth_token: auth_server.make_auth_token({
                    system_id: system._id,
                    role: 'admin',
                    account_id: support_account._id
                })
            }),
            server_rpc.client.host.list_hosts({}, {
                auth_token: auth_server.make_auth_token({
                    system_id: system._id,
                    role: 'admin',
                    account_id: support_account._id
                })
            })
        ])
        .then(([nodes_results, hosts_results]) => {
            //Collect nodes stats
            for (const node of nodes_results.nodes) {
                if (node.has_issues) {
                    nodes_stats.nodes_with_issue += 1;
                }
                nodes_stats.count += 1;
                nodes_histo.histo_allocation.add_value(
                    node.storage.alloc / SCALE_BYTES_TO_GB);
                nodes_histo.histo_usage.add_value(
                    node.storage.used / SCALE_BYTES_TO_GB);
                nodes_histo.histo_free.add_value(
                    node.storage.free / SCALE_BYTES_TO_GB);
                nodes_histo.histo_unavailable_free.add_value(
                    node.storage.unavailable_free / SCALE_BYTES_TO_GB);
                nodes_histo.histo_uptime.add_value(
                    node.os_info.uptime / SCALE_SEC_TO_DAYS);
                if (nodes_stats.os[node.os_info.ostype]) {
                    nodes_stats.os[node.os_info.ostype] += 1;
                } else {
                    nodes_stats.os[node.os_info.ostype] = 1;
                }
            }
            nodes_stats.histograms = _.mapValues(nodes_histo,
                histo => histo.get_object_data(false));
            nodes_stats.hosts_count = hosts_results.hosts.length;
            return nodes_stats;
        })
        .catch(err => {
            dbg.warn('Error in collecting nodes stats,',
                'skipping current sampling point', err.stack || err);
            throw err;
        });
}

function get_ops_stats(req) {
    return P.resolve()
        .then(() => _.mapValues(ops_aggregation, val => val.get_string_data()));
}

function get_bucket_sizes_stats(req) {
    let ret = [];
    for (const b of system_store.data.buckets) {
        if (b.deleting) continue;
        if (b.storage_stats.objects_hist &&
            !_.isEmpty(b.storage_stats.objects_hist)) {
            ret.push({
                master_label: 'Size',
                bins: b.storage_stats.objects_hist.map(bin => ({
                    label: bin.label,
                    count: bin.count,
                    avg: bin.count ? bin.aggregated_sum / bin.count : 0
                }))
            });
        }
    }
    return ret;
}

function get_pool_stats(req) {
    return P.resolve()
        .then(() => nodes_client.instance().aggregate_nodes_by_pool(null, req.system._id))
        .then(nodes_aggregate_pool => _.map(system_store.data.pools,
            pool => _.get(nodes_aggregate_pool, [
                'groups', String(pool._id), 'nodes', 'count'
            ], 0)));
}

async function get_object_usage_stats(req) {
    try {
        const res = await object_server.read_s3_ops_counters(req);
        return {
            system: String(res),
            s3_usage_info: res.s3_usage_info,
            s3_errors_info: res.s3_errors_info
        };

    } catch (err) {
        dbg.warn('Error collecting s3 ops counters, skipping current sampling point', err);
        throw err;
    }
}

async function get_cloud_pool_stats(req) {
    const cloud_pool_stats = _.cloneDeep(CLOUD_POOL_STATS_DEFAULTS);
    const OPTIMAL_MODES = [
        'OPTIMAL',
        'DATA_ACTIVITY',
        'APPROUCHING_QUOTA',
        'RISKY_TOLERANCE',
        'NO_RESOURCES_INTERNAL',
        'TIER_LOW_CAPACITY',
        'LOW_CAPACITY',
    ];
    //Per each system fill out the needed info
    for (const pool of system_store.data.pools) {
        if (pool.mongo_pool_info) continue;
        const pool_info = await server_rpc.client.pool.read_pool({ name: pool.name }, {
            auth_token: req.auth_token
        });

        cloud_pool_stats.pool_count += 1;

        if (!_.includes(OPTIMAL_MODES, pool_info.mode)) {
            cloud_pool_stats.unhealthy_pool_count += 1;
        }

        if (pool.cloud_pool_info) {
            cloud_pool_stats.cloud_pool_count += 1;
            switch (pool.cloud_pool_info.endpoint_type) {
                case 'AWS':
                    cloud_pool_stats.pool_target.amazon += 1;
                    if (!_.includes(OPTIMAL_MODES, pool_info.mode)) {
                        cloud_pool_stats.unhealthy_pool_target.amazon_unhealthy += 1;
                    }
                    break;
                case 'AWSSTS':
                    cloud_pool_stats.pool_target.amazon += 1;
                    if (!_.includes(OPTIMAL_MODES, pool_info.mode)) {
                        cloud_pool_stats.unhealthy_pool_target.amazon_unhealthy += 1;
                    }
                    break;
                case 'AZURE':
                    cloud_pool_stats.pool_target.azure += 1;
                    if (!_.includes(OPTIMAL_MODES, pool_info.mode)) {
                        cloud_pool_stats.unhealthy_pool_target.azure_unhealthy += 1;
                    }
                    break;
                case 'GOOGLE':
                    cloud_pool_stats.pool_target.gcp += 1;
                    if (!_.includes(OPTIMAL_MODES, pool_info.mode)) {
                        cloud_pool_stats.unhealthy_pool_target.gcp_unhealthy += 1;
                    }
                    break;
                case 'S3_COMPATIBLE':
                    cloud_pool_stats.pool_target.s3_comp += 1;
                    if (!_.includes(OPTIMAL_MODES, pool_info.mode)) {
                        cloud_pool_stats.unhealthy_pool_target.s3_comp_unhealthy += 1;
                    }
                    if (pool.cloud_pool_info.auth_method === 'AWS_V2') {
                        cloud_pool_stats.compatible_auth_type.v2 += 1;
                    } else {
                        cloud_pool_stats.compatible_auth_type.v4 += 1;
                    }
                    break;
                default:
                    cloud_pool_stats.pool_target.other += 1;
                    if (!_.includes(OPTIMAL_MODES, pool_info.mode)) {
                        cloud_pool_stats.unhealthy_pool_target.other_unhealthy += 1;
                    }
                    break;
            }
        } else {
            cloud_pool_stats.pool_target.kubernetes += 1;
            if (!_.includes(OPTIMAL_MODES, pool_info.mode)) {
                cloud_pool_stats.unhealthy_pool_target.kubernetes_unhealthy += 1;
            }
        }

        cloud_pool_stats.resources.push({
            resource_name: pool_info.name,
            is_healthy: _.includes(OPTIMAL_MODES, pool_info.mode),
        });
    }

    return cloud_pool_stats;
}

async function get_namespace_resource_stats(req) {
    const namespace_resource_stats = _.cloneDeep(NAMESPACE_RESOURCE_STATS_DEFAULTS);

    await P.all(_.map(system_store.data.namespace_resources, async nsr => {
        const nsr_info = await server_rpc.client.pool.read_namespace_resource({ name: nsr.name }, {
            auth_token: req.auth_token
        });
        const is_healthy = nsr_info.mode === 'OPTIMAL';
        namespace_resource_stats.namespace_resource_count += 1;

        if (!is_healthy) {
            namespace_resource_stats.unhealthy_namespace_resource_count += 1;
        }
        namespace_resource_stats.namespace_resources.push({
            namespace_resource_name: nsr_info.name,
            is_healthy: is_healthy,
        });
    }));
    return namespace_resource_stats;
}

function get_tier_stats(req) {
    return P.resolve()
        .then(() => _.map(system_store.data.tiers, tier => {
            let pools = [];
            _.forEach(tier.mirrors, mirror_object => {
                pools = _.concat(pools, mirror_object.spread_pools);
            });
            pools = _.compact(pools);

            return {
                pools_num: pools.length,
                data_placement: tier.data_placement,
            };
        }));
}

async function get_all_stats(req) {
    var stats_payload = {
        systems_stats: null,
        nodes_stats: null,
        cloud_pool_stats: null,
        bucket_sizes_stats: null,
        ops_stats: null,
        pools_stats: null,
        tier_stats: null,
        object_usage_stats: null,
    };

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Systems');
        stats_payload.systems_stats = await get_systems_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting systems stats, skipping current stats collection', error.stack, error);
        throw error;
    }

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Cloud Pool');
        stats_payload.cloud_pool_stats = await get_cloud_pool_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting cloud pool stats, skipping', error.stack, error);
    }

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Namespace Resource');
        stats_payload.namespace_resource_stats = await get_namespace_resource_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting namespace resource stats, skipping', error.stack, error);
    }

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Nodes');
        stats_payload.nodes_stats = await get_nodes_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting node stats, skipping', error.stack, error);
    }

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Pools');
        stats_payload.pools_stats = await get_pool_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting pool stats, skipping', error.stack, error);
    }

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Bucket Sizes');
        stats_payload.bucket_sizes_stats = get_bucket_sizes_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting bucket sizes stats, skipping', error.stack, error);
    }

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Object Usage');
        stats_payload.object_usage_stats = await get_object_usage_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting node stats, skipping', error.stack, error);
    }

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Tiers');
        stats_payload.tier_stats = await get_tier_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting tier stats, skipping', error.stack, error);
    }

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Ops (STUB)'); //TODO
        stats_payload.ops_stats = await get_ops_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting ops stats, skipping', error.stack, error);
    }

    full_cycle_parse_prometheus_metrics(stats_payload);

    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'END');
    return stats_payload;
}

async function get_partial_stats(req) {
    const { requester } = req.rpc_params;
    if (requester) {
        const now = Date.now();
        if (now - last_partial_stats_requested < PARTIAL_STATS_REQUESTED_GRACE_TIME) return null;
        last_partial_stats_requested = now;
    }

    const stats_payload = {
        systems_stats: null,
        cloud_pool_stats: null,
        accounts_stats: null,
        providers_stats: null,
    };

    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'BEGIN', requester);

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Partial System Stats');
        stats_payload.systems_stats = await get_partial_systems_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting partial systems stats, skipping current stats collection', error.stack, error);
        throw error;
    }

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Cloud Pool');
        stats_payload.cloud_pool_stats = await get_cloud_pool_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting cloud pool stats, skipping', error.stack, error);
    }
    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Namespace Resource');
        stats_payload.namespace_resource_stats = await get_namespace_resource_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting namespace resource stats, skipping', error.stack, error);
    }
    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Partial Account I/O Stats');
        stats_payload.accounts_stats = await get_partial_accounts_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting partial account i/o stats, skipping', error.stack, error);
    }

    try {
        dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Partial Providers Stats');
        stats_payload.providers_stats = await get_partial_providers_stats(req);
    } catch (error) {
        dbg.warn('Error in collecting partial providers stats, skipping', error.stack, error);
    }

    partial_cycle_parse_prometheus_metrics(stats_payload);

    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'END');
    return stats_payload;
}

/*
 * Prometheus Metrics Parsing, POC grade
 */
function partial_cycle_parse_prometheus_metrics(payload) {
    const { cloud_pool_stats, systems_stats, accounts_stats, providers_stats, namespace_resource_stats } = payload;
    const { accounts_num } = accounts_stats;
    // TODO: Support multiple systems
    const {
        buckets_stats,
        namespace_buckets_stats,
        capacity,
        reduction_ratio,
        savings,
        name,
        address,
        usage_by_bucket_class,
        usage_by_project,
        total_usage,
        links,
    } = systems_stats.systems[0];
    const {
        buckets,
        buckets_num,
        objects_in_buckets,
        unhealthy_buckets,
        bucket_claims,
        objects_in_bucket_claims,
        unhealthy_bucket_claims,
    } = buckets_stats;
    const {
        namespace_buckets,
        namespace_buckets_num,
        unhealthy_namespace_buckets
    } = namespace_buckets_stats;
    const { unhealthy_pool_count, pool_count, resources } = cloud_pool_stats;
    const { unhealthy_namespace_resource_count, namespace_resource_count, namespace_resources } = namespace_resource_stats;
    const { logical_size, physical_size } = savings;

    let percentage_of_unhealthy_buckets = unhealthy_buckets / buckets_num;

    // 0 - Everything is fine (BE wise not means that there is no NooBaa CR errors, default status for working system)
    // 1 - All resources are unhealthy
    // 2 - Object bucket has an issue
    // 3 - Many buckets have issues
    // 4 - Some buckets have issues
    let health_status = (unhealthy_pool_count === pool_count && 1) ||
        (unhealthy_buckets === 1 && 2) ||
        (percentage_of_unhealthy_buckets > 0.5 && 4) ||
        (percentage_of_unhealthy_buckets > 0.3 && 3) || 0;
    // 0 = OK, 1 = warning, 2= error
    const odf_health_status = (health_status === 1 && 2) ||
        (health_status >= 1 && 1) || 0;

    const core_report = prom_reporting.get_core_report();
    core_report.set_providers_physical_logical(providers_stats);
    core_report.set_cloud_types(cloud_pool_stats);
    core_report.set_num_unhealthy_pools(unhealthy_pool_count);
    core_report.set_num_unhealthy_namespace_resources(unhealthy_namespace_resource_count);
    core_report.set_num_pools(pool_count);
    core_report.set_num_namespace_resources(namespace_resource_count);
    core_report.set_unhealthy_cloud_types(cloud_pool_stats);
    core_report.set_system_info({ name, address });
    core_report.set_system_links(links);
    core_report.set_num_buckets(buckets_num);
    core_report.set_num_namespace_buckets(namespace_buckets_num);
    core_report.set_bucket_status(buckets);
    core_report.set_namespace_bucket_status(namespace_buckets);
    core_report.set_resource_status(resources);
    core_report.set_namespace_resource_status(namespace_resources);
    core_report.set_num_objects(objects_in_buckets);
    core_report.set_num_unhealthy_buckets(unhealthy_buckets);
    core_report.set_num_unhealthy_namespace_buckets(unhealthy_namespace_buckets);
    core_report.set_health_status(health_status);
    core_report.set_odf_health_status(odf_health_status);
    core_report.set_num_unhealthy_bucket_claims(unhealthy_bucket_claims);
    core_report.set_num_buckets_claims(bucket_claims);
    core_report.set_num_objects_buckets_claims(objects_in_bucket_claims);
    core_report.set_system_capacity(capacity);
    core_report.set_reduction_ratio(reduction_ratio);
    core_report.set_object_savings_physical_size(physical_size);
    core_report.set_object_savings_logical_size(logical_size);
    core_report.set_bucket_class_capacity_usage(usage_by_bucket_class);
    core_report.set_projects_capacity_usage(usage_by_project);
    core_report.set_accounts_io_usage(accounts_stats);
    core_report.set_accounts_num(accounts_num);
    core_report.set_total_usage(total_usage);
    // TODO: Currently mock data, update with the relevant values.
    core_report.set_rebuild_progress(100);
    core_report.set_rebuild_time(0);
}

/*
 * Prometheus Metrics Parsing, POC grade
 */
function full_cycle_parse_prometheus_metrics(payload) {
    const core_report = prom_reporting.get_core_report();
    core_report.set_cloud_types(payload.cloud_pool_stats);
    core_report.set_unhealthy_cloud_types(payload.cloud_pool_stats);
    core_report.set_object_sizes(payload.bucket_sizes_stats);
}

/*
 * OPs stats collection
 */
function register_histogram(opname, master_label, structure) {
    if (typeof(opname) === 'undefined' || typeof(structure) === 'undefined') {
        dbg.log0('register_histogram called with opname', opname, 'structure', structure, 'skipping registration');
        return;
    }

    if (!ops_aggregation[opname]) {
        ops_aggregation[opname] = new Histogram(master_label, structure);
    }

    dbg.log2('register_histogram registered', opname, '-', master_label, 'with', structure);
}

function add_sample_point(opname, duration) {
    if (typeof(opname) === 'undefined' || typeof(duration) === 'undefined') {
        dbg.log0('add_sample_point called with opname', opname, 'duration', duration, 'skipping sampling point');
        return;
    }

    if (!ops_aggregation[opname]) {
        dbg.log0('add_sample_point called without histogram registered (', opname, '), skipping');
        return;
    }

    ops_aggregation[opname].add_value(duration);
}

async function object_usage_scrubber(req) {
    let new_req = req;
    new_req.rpc_params.till_time = req.system.last_stats_report;
    await object_server.reset_s3_ops_counters(new_req);
    new_req.rpc_params.last_stats_report = Date.now();
    await system_server.set_last_stats_report_time(new_req);
}


function get_empty_nodes_histo() {
    //TODO: Add histogram for limit, once implemented
    var empty_nodes_histo = {};
    empty_nodes_histo.histo_allocation = new Histogram('AllocationSizes(GB)', [{
        label: 'low',
        start_val: 0
    }, {
        label: 'med',
        start_val: 100
    }, {
        label: 'high',
        start_val: 500
    }]);

    empty_nodes_histo.histo_usage = new Histogram('UsedSpace(GB)', [{
        label: 'low',
        start_val: 0
    }, {
        label: 'med',
        start_val: 100
    }, {
        label: 'high',
        start_val: 500
    }]);

    empty_nodes_histo.histo_free = new Histogram('FreeSpace(GB)', [{
        label: 'low',
        start_val: 0
    }, {
        label: 'med',
        start_val: 100
    }, {
        label: 'high',
        start_val: 500
    }]);

    empty_nodes_histo.histo_unavailable_free = new Histogram('UnavailableFreeSpace(GB)', [{
        label: 'low',
        start_val: 0
    }, {
        label: 'med',
        start_val: 100
    }, {
        label: 'high',
        start_val: 500
    }]);

    empty_nodes_histo.histo_uptime = new Histogram('Uptime(Days)', [{
        label: 'short',
        start_val: 0
    }, {
        label: 'mid',
        start_val: 14
    }, {
        label: 'long',
        start_val: 30
    }]);

    return empty_nodes_histo;
}

function _handle_payload() {
    let system = system_store.data.systems[0];
    let support_account = _.find(system_store.data.accounts, account => account.is_support);
    return server_rpc.client.stats.object_usage_scrubber({}, {
        auth_token: auth_server.make_auth_token({
            system_id: system._id,
            role: 'admin',
            account_id: support_account._id
        })
    });
}

async function background_worker() {
    if (!system_store.is_finished_initial_load) return;
    const system = system_store.data.systems[0];
    if (!system) return;
    // Shouldn't be more than but just in case
    const is_full_cycle = (current_cycle >= config.central_stats.full_cycle_ratio);

    dbg.log(`STATS_AGGREGATOR ${is_full_cycle ? 'full' : 'partial'} cycle started`);
    //Run the system statistics gatheting

    try {
        if (is_full_cycle) {
            // TODO: This should be changed
            await _perform_partial_cycle();
            await _perform_full_cycle();
            current_cycle = 0;
        } else {
            await _perform_partial_cycle();
            current_cycle += 1;
        }
    } catch (error) {
        dbg.warn(`STATS_AGGREGATOR ${is_full_cycle ? 'full' : 'partial'} cycle failed`, error.stack || error);
    }
}

async function _perform_full_cycle() {
    const system = system_store.data.systems[0];
    const support_account = _.find(system_store.data.accounts, account => account.is_support);

    const payload = await server_rpc.client.stats.get_all_stats({}, {
        auth_token: auth_server.make_auth_token({
            system_id: system._id,
            role: 'admin',
            account_id: support_account._id
        })
    });

    await _handle_payload();

    const free_bytes = size_utils.bigint_to_bytes(payload.systems_stats.systems[0].free_space);
    const total_bytes = size_utils.bigint_to_bytes(payload.systems_stats.systems[0].total_space);

    if (total_bytes > 0) {
        const free_precntage = Math.floor((free_bytes / total_bytes) * 100);
        if (free_precntage < ALERT_LOW_TRESHOLD) {
            Dispatcher.instance().alert('MAJOR',
                system_store.data.systems[0]._id,
                `Free storage is lower than ${ALERT_LOW_TRESHOLD}%`,
                Dispatcher.rules.once_weekly);
        } else if (free_precntage < ALERT_HIGH_TRESHOLD) {
            Dispatcher.instance().alert('MAJOR',
                system_store.data.systems[0]._id,
                `Free storage is lower than ${ALERT_HIGH_TRESHOLD}%`,
                Dispatcher.rules.once_weekly);
        }
    }
}

async function _perform_partial_cycle() {
    const system = system_store.data.systems[0];
    const support_account = _.find(system_store.data.accounts, account => account.is_support);

    await server_rpc.client.stats.get_partial_stats({}, {
        auth_token: auth_server.make_auth_token({
            system_id: system._id,
            role: 'admin',
            account_id: support_account._id
        })
    });
}

async function update_nsfs_stats(req) {
    dbg.log1(`update_nsfs_stats. nsfs_stats =`, req.rpc_params.nsfs_stats);
    const _nsfs_counters = req.rpc_params.nsfs_stats || {};
    if (_nsfs_counters.io_stats) _update_io_stats(_nsfs_counters.io_stats);
    if (_nsfs_counters.op_stats) _update_ops_stats(_nsfs_counters.op_stats);
    if (_nsfs_counters.fs_workers_stats) _update_fs_stats(_nsfs_counters.fs_workers_stats);
}

function _update_io_stats(io_stats) {
    //Go over the io_stats and count
    for (const [key, value] of Object.entries(io_stats)) {
        nsfs_io_counters[key] += value;
    }
}

function _update_ops_stats(ops_stats) {
    // Predefined op_names
    const op_names = [
        `upload_object`,
        `delete_object`,
        `create_bucket`,
        `delete_bucket`,
        `list_objects`,
        `head_object`,
        `initiate_multipart`,
        `upload_part`,
        `complete_object_upload`,
        `read_object`
    ];
    //Go over the op_stats
    for (const op_name of op_names) {
        if (op_name in ops_stats) {
            _set_op_stats(op_name, ops_stats[op_name]);
        }
    }
}

function _update_fs_stats(fs_stats) {
    // Predefined fsworker_names
    const fsworker_names = [
        `stat`,
        `lstat`,
        `statfs`,
        `checkaccess`,
        `unlink`,
        `unlinkat`,
        `link`,
        `linkat`,
        `mkdir`,
        `rmdir`,
        `rename`,
        `writefile`,
        `readfile`,
        `readdir`,
        `fsync`,
        `fileopen`,
        `fileclose`,
        `fileread`,
        `filewrite`,
        `filewritev`,
        `filereplacexattr`,
        `finkfileat`,
        `filegetxattr`,
        `filestat`,
        `filefsync`,
        `realpath`,
        `getsinglexattr`,
        `diropen`,
        `dirclose`,
        `dirreadentry`,
    ];
    //Go over the fs_stats
    for (const fsworker_name of fsworker_names) {
        if (fsworker_name in fs_stats) {
            _set_fs_workers_stats(fsworker_name, fs_stats[fsworker_name]);
        }
    }
}

function _set_op_stats(op_name, stats) {
    //In the event of all of the same ops are failing (count = error_count) we will not masseur the op times
    // As this is intended as a timing masseur and not a counter. 
    if (op_stats[op_name]) {
        const count = op_stats[op_name].count + stats.count;
        const error_count = op_stats[op_name].error_count + stats.error_count;
        const old_sum_time = op_stats[op_name].avg_time_milisec * op_stats[op_name].count;
        //Min time and Max time are not being counted in the endpoint stat collector if it was error
        const min_time_milisec = Math.min(op_stats[op_name].min_time_milisec, stats.min_time);
        const max_time_milisec = Math.max(op_stats[op_name].max_time_milisec, stats.max_time);
        // At this point, as we populate only when there is at least one successful op, there must be old_sum_time
        const avg_time_milisec = Math.floor((old_sum_time + stats.sum_time) / (count - error_count));
        op_stats[op_name] = {
            min_time_milisec,
            max_time_milisec,
            avg_time_milisec,
            count,
            error_count,
        };
        // When it is the first time we populate the op_stats with op_name we do it 
        // only if there are more successful ops than errors.
    } else if (stats.count > stats.error_count) {
        op_stats[op_name] = {
            min_time_milisec: stats.min_time,
            max_time_milisec: stats.max_time,
            avg_time_milisec: Math.floor(stats.sum_time / stats.count),
            count: stats.count,
            error_count: stats.error_count,
        };
    }
}

function _set_fs_workers_stats(fsworker_name, stats) {
    if (fs_workers_stats[fsworker_name]) {
        const count = fs_workers_stats[fsworker_name].count + stats.count;
        const error_count = fs_workers_stats[fsworker_name].error_count + stats.error_count;
        const old_sum_time = fs_workers_stats[fsworker_name].avg_time_microsec * fs_workers_stats[fsworker_name].count;
        //Min time and Max time are not being counted in the namespace_fs if it was error
        const min_time_microsec = Math.min(fs_workers_stats[fsworker_name].min_time_microsec, stats.min_time);
        const max_time_microsec = Math.max(fs_workers_stats[fsworker_name].max_time_microsec, stats.max_time);
        // At this point, as we populate only when there is at least one successful fsworker, there must be old_sum_time
        const avg_time_microsec = Math.floor((old_sum_time + stats.sum_time) / (count - error_count));
        fs_workers_stats[fsworker_name] = {
            min_time_microsec,
            max_time_microsec,
            avg_time_microsec,
            count,
            error_count,
        };
        // When it is the first time we populate the fs_workers_stats with fsworker_name we do it 
        // only if there are more successful ops than errors.
    } else if (stats.count > stats.error_count) {
        fs_workers_stats[fsworker_name] = {
            min_time_microsec: stats.min_time,
            max_time_microsec: stats.max_time,
            avg_time_microsec: Math.floor(stats.sum_time / stats.count),
            count: stats.count,
            error_count: stats.error_count,
        };
    }
}

function _new_nsfs_stats() {
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

// Will return the current nsfs_io_counters and reset it.
function get_nsfs_io_stats() {
    const nsfs_io_stats = nsfs_io_counters;
    nsfs_io_counters = _new_nsfs_stats();
    return nsfs_io_stats;
}

// Will return the current op_stats and reset it.
function get_op_stats() {
    const nsfs_op_stats = op_stats;
    op_stats = {};
    return nsfs_op_stats;
}

// Will return the current fs_workers_stats and reset it.
function get_fs_workers_stats() {
    const nsfs_fs_workers_stats = fs_workers_stats;
    fs_workers_stats = {};
    return nsfs_fs_workers_stats;
}

// EXPORTS
//stats getters
exports.get_systems_stats = get_systems_stats;
exports.get_nodes_stats = get_nodes_stats;
exports.get_ops_stats = get_ops_stats;
exports.get_pool_stats = get_pool_stats;
exports.get_cloud_pool_stats = get_cloud_pool_stats;
exports.get_namespace_resource_stats = get_namespace_resource_stats;
exports.get_tier_stats = get_tier_stats;
exports.get_all_stats = get_all_stats;
exports.get_partial_systems_stats = get_partial_systems_stats;
exports.get_partial_accounts_stats = get_partial_accounts_stats;
exports.get_partial_providers_stats = get_partial_providers_stats;
exports.get_partial_stats = get_partial_stats;
exports.get_bucket_sizes_stats = get_bucket_sizes_stats;
exports.get_object_usage_stats = get_object_usage_stats;
exports.get_nsfs_io_stats = get_nsfs_io_stats;
exports.get_op_stats = get_op_stats;
exports.get_fs_workers_stats = get_fs_workers_stats;
//OP stats collection
exports.register_histogram = register_histogram;
exports.add_sample_point = add_sample_point;
exports.object_usage_scrubber = object_usage_scrubber;
exports.send_stats = background_worker;
exports.background_worker = background_worker;
exports.update_nsfs_stats = update_nsfs_stats;
