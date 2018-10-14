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
const P = require('../../util/promise');
const net_utils = require('../../util/net_utils');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const pkg = require('../../../package.json');
const Histogram = require('../../util/histogram');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const system_server = require('../system_services/system_server');
const object_server = require('../object_services/object_server');
const auth_server = require('../common_services/auth_server');
const server_rpc = require('../server_rpc');
const size_utils = require('../../util/size_utils');
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
        dns_search: 0,
        ntp_server: false,
        proxy: false,
        remote_syslog: false
    },
    cluster: {
        members: 0
    }
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
function get_systems_stats(req) {
    var sys_stats = _.cloneDeep(SYSTEM_STATS_DEFAULTS);
    sys_stats.agent_version = process.env.AGENT_VERSION || 'Unknown';
    sys_stats.count = system_store.data.systems.length;
    var cluster = system_store.data.clusters[0];
    if (cluster && cluster.cluster_id) {
        sys_stats.clusterid = cluster.cluster_id;
    }

    return P.all(_.map(system_store.data.systems, system => {
            let new_req = _.defaults({
                system: system
            }, req);
            return system_server.read_system(new_req)
                .then(res => {
                    // Means that if we do not have any systems, the version number won't be sent
                    sys_stats.version = res.version || process.env.CURRENT_VERSION;
                    const buckets_config = _aggregate_buckets_config(res);
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
                            dns_name: system.base_address && !net_utils.is_ip(system.base_address),
                            dns_search: res.cluster.shards[0].servers[0].search_domains.length,
                            ntp_server: !_.isEmpty(res.cluster.shards[0].servers[0].ntp_server),
                            proxy: !_.isEmpty(res.phone_home_config.proxy_address),
                            remote_syslog: !_.isEmpty(res.remote_syslog_config),
                        },
                        cluster: {
                            members: res.cluster.shards[0].servers.length
                        }
                    }, SINGLE_SYS_DEFAULTS);
                });
        }))
        .then(systems => {
            sys_stats.systems = systems;
            return HistoryDataStore.instance().get_system_version_history();
        })
        .then(version_history => {
            sys_stats.version_history = version_history;
            return sys_stats;
        })
        .catch(err => {
            dbg.warn('Error in collecting systems stats,',
                'skipping current sampling point', err.stack || err);
            throw err;
        });
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
        other: 0,
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

function get_cloud_pool_stats(req) {
    return P.resolve()
        .then(() => {
            var cloud_pool_stats = _.cloneDeep(CLOUD_POOL_STATS_DEFAULTS);
            //Per each system fill out the needed info
            _.forEach(system_store.data.pools, pool => {
                cloud_pool_stats.pool_count += 1;
                if (pool.cloud_pool_info) {
                    cloud_pool_stats.cloud_pool_count += 1;
                    switch (pool.cloud_pool_info.endpoint_type) {
                        case 'AWS':
                            cloud_pool_stats.cloud_pool_target.amazon += 1;
                            break;
                        case 'AZURE':
                            cloud_pool_stats.cloud_pool_target.azure += 1;
                            break;
                        case 'GOOGLE':
                            cloud_pool_stats.cloud_pool_target.gcp += 1;
                            break;
                        default:
                            cloud_pool_stats.cloud_pool_target.other += 1;
                            if (pool.cloud_pool_info.endpoint_type === 'S3_COMPATIBLE') {
                                if (pool.cloud_pool_info.auth_method === 'AWS_V2') {
                                    cloud_pool_stats.compatible_auth_type.v2 += 1;
                                } else {
                                    cloud_pool_stats.compatible_auth_type.v4 += 1;
                                }
                            }
                            break;
                    }
                }
            });

            return cloud_pool_stats;
        });
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

//Collect operations related stats and usage
function get_all_stats(req) {
    //var self = this;
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

    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'BEGIN');
    return P.fcall(() => {
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Systems');
            return get_systems_stats(req);
        })
        .catch(err => {
            dbg.warn('Error in collecting systems stats, skipping current stats collection', err.stack, err);
            throw err;
        })
        .then(systems_stats => {
            stats_payload.systems_stats = systems_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Nodes');
            return get_nodes_stats(req)
                .catch(err => {
                    dbg.warn('Error in collecting node stats, skipping', err.stack, err);
                    return {};
                });
        })
        .then(nodes_stats => {
            stats_payload.nodes_stats = nodes_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Pools');
            return get_pool_stats(req)
                .catch(err => {
                    dbg.warn('Error in collecting pool stats, skipping', err.stack, err);
                    return {};
                });
        })
        .then(pools_stats => {
            stats_payload.pools_stats = pools_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Cloud Pool');
            return get_cloud_pool_stats(req)
                .catch(err => {
                    dbg.warn('Error in collecting cloud pool stats, skipping', err.stack, err);
                    return {};
                });
        })
        .then(cloud_pool_stats => {
            stats_payload.cloud_pool_stats = cloud_pool_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Bucket Sizes');
            return get_bucket_sizes_stats(req);
        })
        .then(bucket_sizes_stats => {
            stats_payload.bucket_sizes_stats = bucket_sizes_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Object Usage');
            return get_object_usage_stats(req)
                .catch(err => {
                    dbg.warn('Error in collecting node stats, skipping', err.stack, err);
                    return {};
                });
        })
        .then(object_usage_stats => {
            stats_payload.object_usage_stats = object_usage_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Tiers');
            return get_tier_stats(req)
                .catch(err => {
                    dbg.warn('Error in collecting tier stats, skipping', err.stack, err);
                    return {};
                });
        })
        .then(tier_stats => {
            stats_payload.tier_stats = tier_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Ops (STUB)'); //TODO
            return get_ops_stats(req)
                .catch(err => {
                    dbg.warn('Error in collecting ops stats, skipping', err.stack, err);
                    return {};
                });
        })
        .then(ops_stats => {
            stats_payload.ops_stats = ops_stats;
            parse_prometheus_metrics(stats_payload);
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'END');
            return stats_payload;
        })
        .catch(err => {
            dbg.warn('SYSTEM_SERVER_STATS_AGGREGATOR:', 'ERROR', err.stack);
            throw err;
        });
}

/*
 * Prometheus Metrics Parsing, POC grade
 */
function parse_prometheus_metrics(payload) {
    prom_report.instance().set_cloud_types(payload.cloud_pool_stats);
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

function background_worker() {
    let statistics;

    if (!system_store.is_finished_initial_load) return P.resolve();
    let system = system_store.data.systems[0];
    if (!system) return P.resolve();

    dbg.log('Central Statistics gathering started');
    //Run the system statistics gatheting
    return P.resolve()
        .then(() => _notify_latest_version())
        .then(() => {
            let support_account = _.find(system_store.data.accounts, account => account.is_support);
            return server_rpc.client.stats.get_all_stats({}, {
                auth_token: auth_server.make_auth_token({
                    system_id: system._id,
                    role: 'admin',
                    account_id: support_account._id
                })
            });
        })
        .then(payload => {
            statistics = payload;
            return _handle_payload(payload);
        })
        .then(() => {
            const free_bytes = size_utils.bigint_to_bytes(statistics.systems_stats.systems[0].free_space);
            const total_bytes = size_utils.bigint_to_bytes(statistics.systems_stats.systems[0].total_space);

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
        }) // adding to here
        .catch(err => {
            dbg.warn('Phone Home data send failed', err.stack || err);
        })
        .return();
}

async function _notify_latest_version() {
    try {
        const results = await P.fromCallback(callback => google_storage.objects.list({
            bucket: 'noobaa-fe-assets',
            prefix: 'release-notes/',
            delimiter: '/',
        }, callback));

        const items = results.items;
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

        const is_same_major_latest_alpha = same_major_latest.split('-').length > 1 && same_major_latest.split('-')[1] === 'alpha';
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
exports.get_bucket_sizes_stats = get_bucket_sizes_stats;
exports.get_object_usage_stats = get_object_usage_stats;
//OP stats collection
exports.register_histogram = register_histogram;
exports.add_sample_point = add_sample_point;
exports.object_usage_scrubber = object_usage_scrubber;
exports.send_stats = background_worker;
exports.background_worker = background_worker;
