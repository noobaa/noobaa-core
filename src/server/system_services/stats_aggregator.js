/* Copyright (C) 2016 NooBaa */
/**
 *
 * STATS_AGGREGATOR
 *
 */
'use strict';

const DEV_MODE = (process.env.DEV_MODE === 'true');
const _ = require('lodash');
const request = require('request');
const fs = require('fs');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const pkg = require('../../../package.json');
const Histogram = require('../../util/histogram');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const system_server = require('../system_services/system_server');
const bucket_server = require('../system_services/bucket_server');
const object_server = require('../object_services/object_server');
const auth_server = require('../common_services/auth_server');
const server_rpc = require('../server_rpc');
const size_utils = require('../../util/size_utils');
const net_utils = require('../../util/net_utils');
const fs_utils = require('../../util/fs_utils');
const Dispatcher = require('../notifications/dispatcher');
const prom_report = require('../analytic_services/prometheus_reporting').PrometheusReporting;
const HistoryDataStore = require('../analytic_services/history_data_store').HistoryDataStore;
const { google } = require('googleapis');
const google_storage = google.storage('v1');


const ops_aggregation = {};
const SCALE_BYTES_TO_GB = 1024 * 1024 * 1024;
const SCALE_SEC_TO_DAYS = 60 * 60 * 24;

const ALERT_LOW_TRESHOLD = 10;
const ALERT_HIGH_TRESHOLD = 20;

var failed_sent = 0;
// This value is non persistent on process restarts
// This means that there might be a situation when we won't get phone home data
// If the process will always crash prior to reaching the required amount of cycles (full_cycle_ratio)
// Also in case of failures with sending the phone home we won't perform the partial cycles
// TODO: Maybe add some sort of a timeout mechanism to the failures in order to perform partial cycles?
var current_cycle = 0;

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
        ntp_server: false,
        proxy: false,
    },
    cluster: {
        members: 0
    }
};

const PARTIAL_BUCKETS_STATS_DEFAULTS = {
    buckets: 0,
    objects_in_buckets: 0,
    unhealthy_buckets: 0,
    bucket_claims: 0,
    objects_in_bucket_claims: 0,
};

const PARTIAL_SYSTEM_STATS_DEFAULTS = {
    systems: [],
};

const PARTIAL_SINGLE_SYS_DEFAULTS = {
    name: '',
    free_space: 0,
    total_space: 0,
    buckets_stats: PARTIAL_BUCKETS_STATS_DEFAULTS,
};



//Aggregate bucket configuration and policies
function _aggregate_buckets_config(system) {
    let bucket_config = [];
    for (const cbucket of system.buckets) {
        let current_config = {};
        current_config.num_objects = cbucket.num_objects;
        current_config.versioning = cbucket.versioning;
        current_config.quota = Boolean(cbucket.quota);
        current_config.tiers = [];
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
        bucket_config.push(current_config);
    }
    return bucket_config;
}

//Collect systems related stats and usage
async function get_systems_stats(req) {
    var sys_stats = _.cloneDeep(SYSTEM_STATS_DEFAULTS);
    sys_stats.agent_version = process.env.AGENT_VERSION || 'Unknown';
    sys_stats.count = system_store.data.systems.length;
    sys_stats.os_release = (await fs.readFileAsync('/etc/redhat-release').catch(fs_utils.ignore_enoent) || 'unkonwn').toString();
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
                    ntp_server: !_.isEmpty(res.cluster.shards[0].servers[0].ntp_server),
                    proxy: !_.isEmpty(res.phone_home_config.proxy_address),
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


async function get_partial_systems_stats(req) {
    const sys_stats = _.cloneDeep(PARTIAL_SYSTEM_STATS_DEFAULTS);
    try {
        sys_stats.systems = await P.all(_.map(system_store.data.systems, async system => {
            const new_req = _.defaults({
                system: system
            }, req);

            const { buckets_stats, objects_sys } = await _partial_buckets_info(new_req);

            // nodes - count, online count, allocated/used storage aggregate by pool
            const nodes_aggregate_pool_with_cloud_no_mongo = await nodes_client.instance()
                .aggregate_nodes_by_pool(null, system._id, /*skip_cloud_nodes=*/ false, /*skip_mongo_nodes=*/ true);

            const storage = size_utils.to_bigint_storage(_.defaults({
                used: objects_sys.size,
            }, nodes_aggregate_pool_with_cloud_no_mongo.storage, SYS_STORAGE_DEFAULTS));

            return _.defaults({
                name: system.name,
                total_space: storage.total,
                free_space: storage.free,
                buckets_stats
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
    const objects_sys = {
        count: size_utils.BigInteger.zero,
        size: size_utils.BigInteger.zero,
    };
    try {
        for (const bucket of system_store.data.buckets) {
            if (String(bucket.system._id) !== String(req.system._id)) return;
            const new_req = _.defaults({
                rpc_params: { name: bucket.name, },
            }, req);

            const bucket_info = await bucket_server.read_bucket(new_req);

            objects_sys.size = objects_sys.size.plus(
                (bucket_info.storage_stats && bucket_info.storage_stats.objects_size) || 0
            );
            objects_sys.count = objects_sys.count.plus(bucket_info.num_objects || 0);


            if (bucket_info.namespace) return;

            buckets_stats.buckets += 1;
            buckets_stats.objects_in_buckets += bucket_info.num_objects;

            if (bucket_info.bucket_claim) {
                buckets_stats.bucket_claims += 1;
                buckets_stats.objects_in_bucket_claims += bucket_info.num_objects;
            }

            const OPTIMAL_MODES = [
                'LOW_CAPACITY',
                'HIGH_DATA_ACTIVITY',
                'OPTIMAL',
            ];
            if (!_.includes(OPTIMAL_MODES, bucket_info.mode)) buckets_stats.unhealthy_buckets += 1;
        }
        return { buckets_stats, objects_sys };
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
    cloud_pool_count: 0,
    cloud_pool_target: {
        amazon: 0,
        azure: 0,
        gcp: 0,
        s3_comp: 0,
        other: 0,
    },
    unhealthy_cloud_pool_target: {
        amazon_unhealthy: 0,
        azure_unhealthy: 0,
        gcp_unhealthy: 0,
        s3_comp_unhealthy: 0,
        other_unhealthy: 0,
    },
    compatible_auth_type: {
        v2: 0,
        v4: 0,
    }
};

//Collect nodes related stats and usage
function get_nodes_stats(req) {
    var nodes_stats = _.cloneDeep(NODES_STATS_DEFAULTS);
    var nodes_histo = get_empty_nodes_histo();
    //Per each system fill out the needed info
    const system = system_store.data.systems[0];
    const support_account = _.find(system_store.data.accounts, account => account.is_support);

    return P.join(
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
            }))
        .spread((nodes_results, hosts_results) => {
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

function get_object_usage_stats(req) {
    let new_req = req;
    new_req.rpc_params.from_time = req.system.last_stats_report;
    return object_server.read_endpoint_usage_report(new_req)
        .then(res => _.map(res.reports, report => ({
            system: String(report.system),
            time: report.time,
            s3_usage_info: report.s3_usage_info,
            s3_errors_info: report.s3_errors_info
        })))
        .catch(err => {
            dbg.warn('Error in collecting object usage stats,',
                'skipping current sampling point', err.stack || err);
            throw err;
        });
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
        cloud_pool_stats.pool_count += 1;
        if (pool.cloud_pool_info) {
            const pool_info = await server_rpc.client.pool.read_pool({ name: pool.name }, {
                auth_token: req.auth_token
            });
            cloud_pool_stats.cloud_pool_count += 1;
            switch (pool.cloud_pool_info.endpoint_type) {
                case 'AWS':
                    if (_.includes(OPTIMAL_MODES, pool_info.mode)) {
                        cloud_pool_stats.cloud_pool_target.amazon += 1;
                    } else {
                        cloud_pool_stats.unhealthy_cloud_pool_target.amazon_unhealthy += 1;
                    }
                    break;
                case 'AZURE':
                    if (_.includes(OPTIMAL_MODES, pool_info.mode)) {
                        cloud_pool_stats.cloud_pool_target.azure += 1;
                    } else {
                        cloud_pool_stats.unhealthy_cloud_pool_target.azure_unhealthy += 1;
                    }
                    break;
                case 'GOOGLE':
                    if (_.includes(OPTIMAL_MODES, pool_info.mode)) {
                        cloud_pool_stats.cloud_pool_target.gcp += 1;
                    } else {
                        cloud_pool_stats.unhealthy_cloud_pool_target.gcp_unhealthy += 1;
                    }
                    break;
                case 'S3_COMPATIBLE':
                    if (_.includes(OPTIMAL_MODES, pool_info.mode)) {
                        cloud_pool_stats.cloud_pool_target.s3_comp += 1;
                    } else {
                        cloud_pool_stats.unhealthy_cloud_pool_target.s3_comp_unhealthy += 1;
                    }
                    if (pool.cloud_pool_info.auth_method === 'AWS_V2') {
                        cloud_pool_stats.compatible_auth_type.v2 += 1;
                    } else {
                        cloud_pool_stats.compatible_auth_type.v4 += 1;
                    }
                    break;
                default:
                    if (_.includes(OPTIMAL_MODES, pool_info.mode)) {
                        cloud_pool_stats.cloud_pool_target.other += 1;
                    } else {
                        cloud_pool_stats.unhealthy_cloud_pool_target.other_unhealthy += 1;
                    }
                    break;
            }
        }
    }

    return cloud_pool_stats;
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
    const stats_payload = {
        systems_stats: null,
        cloud_pool_stats: null,
    };

    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'BEGIN');

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

    partial_cycle_parse_prometheus_metrics(stats_payload);

    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'END');
    return stats_payload;
}

/*
 * Prometheus Metrics Parsing, POC grade
 */
function partial_cycle_parse_prometheus_metrics(payload) {
    const { cloud_pool_stats, systems_stats } = payload;
    // TODO: Support multiple systems
    const { buckets_stats, free_space, total_space, name } = systems_stats.systems[0];
    const { buckets, objects_in_buckets, unhealthy_buckets, bucket_claims, objects_in_bucket_claims } = buckets_stats;
    const free_bytes = size_utils.bigint_to_bytes(free_space);
    const total_bytes = size_utils.bigint_to_bytes(total_space);
    const capacity = 100 - Math.floor((free_bytes / total_bytes) * 100);

    prom_report.instance().set_cloud_types(cloud_pool_stats);
    prom_report.instance().set_unhealthy_cloud_types(cloud_pool_stats);
    prom_report.instance().set_system_name(name);
    prom_report.instance().set_num_buckets(buckets);
    prom_report.instance().set_num_objects(objects_in_buckets);
    prom_report.instance().set_num_unhealthy_buckets(unhealthy_buckets);
    prom_report.instance().set_num_buckets_claims(bucket_claims);
    prom_report.instance().set_num_objects_buckets_claims(objects_in_bucket_claims);
    prom_report.instance().set_system_capacity(capacity);
}

/*
 * Prometheus Metrics Parsing, POC grade
 */
function full_cycle_parse_prometheus_metrics(payload) {
    prom_report.instance().set_cloud_types(payload.cloud_pool_stats);
    prom_report.instance().set_unhealthy_cloud_types(payload.cloud_pool_stats);
    prom_report.instance().set_object_sizes(payload.bucket_sizes_stats);
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
    await object_server.remove_endpoint_usage_reports(new_req);
    new_req.rpc_params.last_stats_report = Date.now();
    await system_server.set_last_stats_report_time(new_req);
}

//_.noop(send_stats_payload); // lint unused bypass

function send_stats_payload(payload) {
    var system = system_store.data.systems[0];
    var options = {
        url: config.PHONE_HOME_BASE_URL + '/phdata',
        method: 'POST',
        body: {
            time_stamp: new Date(),
            system: String(system._id),
            payload: payload
        },
        strictSSL: false, // means rejectUnauthorized: false
        json: true,
        gzip: true,
    };

    // TODO: Support Self Signed HTTPS Proxy
    // The problem is that we don't support self signed proxies, because somehow
    // The strictSSL value is only valid for the target and not for the Proxy
    // Check that once again sine it is a guess (did not investigate much)
    if (system.phone_home_proxy_address) {
        options.proxy = system.phone_home_proxy_address;
    }

    dbg.log0('Phone Home Sending Post Request To Server:', options);
    return P.fromCallback(callback => request(options, callback), {
            multiArgs: true
        })
        .spread(function(response, body) {
            dbg.log0('Phone Home Received Response From Server', body);
            return body;
        });
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

function _handle_payload(payload) {
    return P.resolve()
        .then(() => {
            if (DEV_MODE) {
                dbg.log('Central Statistics payload send is disabled in DEV_MODE');
                return P.resolve();
            }
            return send_stats_payload(payload);
        })
        .catch(err => {
            failed_sent += 1;
            if (failed_sent > 5) {
                let updates = {
                    _id: system_store.data.systems[0]._id.toString(),
                    freemium_cap: {
                        phone_home_unable_comm: true
                    }
                };
                return system_store.make_changes({
                        update: {
                            systems: [updates]
                        }
                    })
                    .then(() => {
                        throw err;
                    });
            }
            throw err;
        })
        .then(() => {
            let system = system_store.data.systems[0];
            let support_account = _.find(system_store.data.accounts, account => account.is_support);
            return server_rpc.client.stats.object_usage_scrubber({}, {
                auth_token: auth_server.make_auth_token({
                    system_id: system._id,
                    role: 'admin',
                    account_id: support_account._id
                })
            });
        })
        .then(() => dbg.log('Phone Home data was sent successfuly'));

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

    await _notify_latest_version();

    const payload = await server_rpc.client.stats.get_all_stats({}, {
        auth_token: auth_server.make_auth_token({
            system_id: system._id,
            role: 'admin',
            account_id: support_account._id
        })
    });

    await _handle_payload(payload);

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

async function _notify_latest_version() {
    try {
        const results = await google_storage.objects.list({
            bucket: 'noobaa-fe-assets',
            prefix: 'release-notes/',
            delimiter: '/',
        });

        const items = results.data.items;
        const [current_major, current_minor, current_patch] = pkg.version.split('-')[0].split('.').map(str => Number(str));
        const current_val = (current_major * 10000) + (current_minor * 100) + current_patch;
        const un_sorted_files = _.compact(items.map(fl => fl.name
            .replace('release-notes/', '')
            .replace('.txt', '')));
        const files = un_sorted_files.sort((a, b) => {
            const [a_major, a_minor, a_patch] = a.split('-')[0].split('.').map(str => Number(str));
            const [b_major, b_minor, b_patch] = b.split('-')[0].split('.').map(str => Number(str));
            const a_val = (a_major * 10000) + (a_minor * 100) + a_patch;
            const b_val = (b_major * 10000) + (b_minor * 100) + b_patch;
            if (a_val < b_val) return -1;
            if (a_val > b_val) return 1;
            return 0;
        });

        dbg.log0('_notify_latest_version gcloud response:', files);

        const same_major_latest = _.last(
            _.filter(files, ver => {
                const major = Number(ver.split('-')[0].split('.')[0]);
                return Boolean(major === current_major);
            })
        );
        const latest_version = _.last(files);

        dbg.log0('_notify_latest_version latest_version:', latest_version, ' same_major_latest:', same_major_latest, ' current_val:', current_val);

        let latest_version_val;
        let same_major_latest_val;
        if (latest_version) {
            const [major, minor, patch] = latest_version.split('-')[0].split('.').map(str => Number(str));
            latest_version_val = (major * 10000) + (minor * 100) + patch;
        }
        if (same_major_latest) {
            const [major, minor, patch] = same_major_latest.split('-')[0].split('.').map(str => Number(str));
            same_major_latest_val = (major * 10000) + (minor * 100) + patch;
        }

        const is_same_major_latest_alpha = same_major_latest &&
            same_major_latest.split('-').length > 1 &&
            same_major_latest.split('-')[1] === 'alpha';
        const is_latest_version_alpha = latest_version.split('-').length > 1 && latest_version.split('-')[1] === 'alpha';

        if (!is_same_major_latest_alpha && same_major_latest && current_val < same_major_latest_val) {
            Dispatcher.instance().alert('INFO',
                system_store.data.systems[0]._id,
                `A newer version of NooBaa, ${same_major_latest}, is now available, check your inbox for details or send us a download request to support@noobaa.com`,
                Dispatcher.rules.once_weekly);
        }
        if (!is_latest_version_alpha && (
                (same_major_latest &&
                    same_major_latest_val < latest_version_val) ||
                (!same_major_latest &&
                    current_val < latest_version_val))) {
            Dispatcher.instance().alert('INFO',
                system_store.data.systems[0]._id,
                `A new NooBaa platform version is now available, for migrating to the new platform please contact support at support@noobaa.com`,
                Dispatcher.rules.once_weekly);
        }
    } catch (err) {
        dbg.error('_notify_latest_version had error', err);
    }
}

// EXPORTS
//stats getters
exports.get_systems_stats = get_systems_stats;
exports.get_nodes_stats = get_nodes_stats;
exports.get_ops_stats = get_ops_stats;
exports.get_pool_stats = get_pool_stats;
exports.get_cloud_pool_stats = get_cloud_pool_stats;
exports.get_tier_stats = get_tier_stats;
exports.get_all_stats = get_all_stats;
exports.get_partial_systems_stats = get_partial_systems_stats;
exports.get_partial_stats = get_partial_stats;
exports.get_bucket_sizes_stats = get_bucket_sizes_stats;
exports.get_object_usage_stats = get_object_usage_stats;
//OP stats collection
exports.register_histogram = register_histogram;
exports.add_sample_point = add_sample_point;
exports.object_usage_scrubber = object_usage_scrubber;
exports.send_stats = background_worker;
exports.background_worker = background_worker;
