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
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const Histogram = require('../../util/histogram');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const system_server = require('../system_services/system_server');
const object_server = require('../object_services/object_server');
const bucket_server = require('../system_services/bucket_server');
const auth_server = require('../common_services/auth_server');
const server_rpc = require('../server_rpc');

const ops_aggregation = {};
const SCALE_BYTES_TO_GB = 1024 * 1024 * 1024;
const SCALE_BYTES_TO_MB = 1024 * 1024;
const SCALE_SEC_TO_DAYS = 60 * 60 * 24;

var successfuly_sent_period = 0;
var failed_sent = 0;

/*
 * Stats Collction API
 */
const SYSTEM_STATS_DEFAULTS = {
    clusterid: '',
    version: '',
    agent_version: '',
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
};

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
                    return _.defaults({
                        roles: res.roles.length,
                        tiers: res.tiers.length,
                        buckets: res.buckets.length,
                        objects: res.objects,
                        allocated_space: res.storage.alloc,
                        used_space: res.storage.used,
                        total_space: res.storage.total,
                        associated_nodes: {
                            on: res.nodes.online,
                            off: res.nodes.count - res.nodes.online,
                        },
                        owner: res.owner.email,
                    }, SINGLE_SYS_DEFAULTS);
                });
            // TODO: Need to handle it differently
            // .then(function(res) {
            //     let last_stats_report = system.last_stats_report || 0;
            //     var query = {
            //         system: system._id,
            //         // Notice that we only count the chunks that finished their rebuild
            //         last_build: {
            //             $gt: new Date(last_stats_report)
            //         },
            //         // Ignore old chunks without buckets
            //         bucket: {
            //             $exists: true
            //         },
            //         deleted: null
            //     };
            //
            //     return DataChunk.collection.count(query)
            //         .then(count => {
            //             res.chunks_rebuilt_since_last = count;
            //             return res;
            //         })
            //         .catch(err => {
            //             dbg.log0('Could not fetch chunks_rebuilt_since_last', err);
            //             return res;
            //         });
            // });
        }))
        .then(systems => {
            sys_stats.systems = systems;
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
    os: {
        win: 0,
        osx: 0,
        linux: 0,
        other: 0,
    },
    nodes_with_issue: 0
};

const SYNC_STATS_DEFAULTS = {
    bucket_count: 0,
    sync_count: 0,
    sync_type: {
        bi_directional: 0,
        n2c: 0,
        c2n: 0,
        additions_only: 0,
        additions_and_deletions: 0,
    },
    sync_target: {
        amazon: 0,
        other: 0,
    },
};

const CLOUD_POOL_STATS_DEFAULTS = {
    pool_count: 0,
    cloud_pool_count: 0,
    cloud_pool_target: {
        amazon: 0,
        other: 0,
    },
};

//Collect nodes related stats and usage
function get_nodes_stats(req) {
    var nodes_stats = _.cloneDeep(NODES_STATS_DEFAULTS);
    var nodes_histo = get_empty_nodes_histo();
    //Per each system fill out the needed info
    return P.all(_.map(system_store.data.systems,
            system => nodes_client.instance().list_nodes_by_system(system._id)))
        .then(results => {
            for (const system_nodes of results) {
                for (const node of system_nodes.nodes) {
                    if (node.has_issues) {
                        nodes_stats.nodes_with_issue++;
                    }
                    nodes_stats.count++;
                    nodes_histo.histo_allocation.add_value(
                        node.storage.alloc / SCALE_BYTES_TO_GB);
                    nodes_histo.histo_usage.add_value(
                        node.storage.used / SCALE_BYTES_TO_GB);
                    nodes_histo.histo_free.add_value(
                        node.storage.free / SCALE_BYTES_TO_GB);
                    nodes_histo.histo_uptime.add_value(
                        node.os_info.uptime / SCALE_SEC_TO_DAYS);
                    if (node.os_info.ostype === 'Darwin') {
                        nodes_stats.os.osx++;
                    } else if (node.os_info.ostype === 'Windows_NT') {
                        nodes_stats.os.win++;
                    } else if (node.os_info.ostype === 'Linux') {
                        nodes_stats.os.linux++;
                    } else {
                        nodes_stats.os.other++;
                    }
                }
            }
            nodes_stats.histograms = _.mapValues(nodes_histo,
                histo => histo.get_object_data(false));
            return nodes_stats;
        })
        .catch(err => {
            dbg.warn('Error in collecting nodes stats,',
                'skipping current sampling point', err.stack || err);
            throw err;
        });
}

function get_ops_stats(req) {
    return _.mapValues(ops_aggregation, val => val.get_string_data());
}

function get_bucket_sizes_stats(req) {
    return P.all(_.map(system_store.data.buckets,
            bucket => {
                // TODO disabled the object listing here which crashes the process out of memory
                return [];
                // let new_req = req;
                // new_req.rpc_params.bucket = bucket.name;
                // return object_server.list_objects(new_req);
            }
        ))
        .then(bucket_arr => {
            let histo_arr = [];
            _.each(bucket_arr, bucket_res => {
                let objects_histo = get_empty_objects_histo();
                _.forEach(bucket_res.objects, obj =>
                    objects_histo.histo_size.add_value(obj.info.size / SCALE_BYTES_TO_MB));
                histo_arr.push(_.mapValues(objects_histo, histo => histo.get_object_data(false)));
            });
            return histo_arr;
        });
}

function get_pool_stats(req) {
    return P.resolve()
        .then(() => nodes_client.instance().aggregate_nodes_by_pool(null, req.system._id))
        .then(nodes_aggregate_pool => _.map(system_store.data.pools,
            pool => _.get(nodes_aggregate_pool, [
                'groups', String(pool._id), 'nodes', 'count'
            ], 0)));
}

function get_cloud_sync_stats(req) {
    var sync_stats = _.cloneDeep(SYNC_STATS_DEFAULTS);
    var sync_histo = get_empty_sync_histo();
    //Per each system fill out the needed info
    return P.all(_.map(system_store.data.systems,
            system => {
                let new_req = _.defaults({
                    system: system
                }, req);
                return bucket_server.get_all_cloud_sync(new_req);
            }
        ))
        .then(results => {
            for (var isys = 0; isys < results.length; ++isys) {
                for (var ipolicy = 0; ipolicy < results[isys].length; ++ipolicy) {
                    let cloud_sync = results[isys][ipolicy];
                    sync_stats.bucket_count++;
                    if (Object.getOwnPropertyNames(cloud_sync).length) {
                        sync_stats.sync_count++;
                        if (cloud_sync.policy.additions_only) {
                            sync_stats.sync_type.additions_only++;
                        } else {
                            sync_stats.sync_type.additions_and_deletions++;
                        }

                        if (cloud_sync.policy.n2c_enabled && cloud_sync.policy.c2n_enabled) {
                            sync_stats.sync_type.bi_directional++;
                        } else if (cloud_sync.policy.n2c_enabled) {
                            sync_stats.sync_type.n2c++;
                        } else if (cloud_sync.policy.c2n_enabled) {
                            sync_stats.sync_type.c2n++;
                        }

                        if (cloud_sync.endpoint) {
                            if (cloud_sync.endpoint.indexOf('amazonaws.com') > -1) {
                                sync_stats.sync_target.amazon++;
                            } else {
                                sync_stats.sync_target.other++;
                            }
                        }
                        sync_histo.histo_schedule.add_value(cloud_sync.policy.schedule_min);
                    }
                }
            }
            sync_stats.histograms = _.mapValues(sync_histo, histo => histo.get_object_data(false));
            return sync_stats;
        })
        .catch(err => {
            dbg.warn('Error in collecting sync stats,',
                'skipping current sampling point', err.stack || err);
            throw err;
        });
}

function get_object_usage_stats(req) {
    let new_req = req;
    new_req.rpc_params.from_time = req.system.last_stats_report;
    return object_server.read_s3_usage_report(new_req)
        .then(res => {
            return _.map(res.reports, report => ({
                system: String(report.system),
                time: report.time,
                s3_usage_info: report.s3_usage_info,
                s3_errors_info: report.s3_errors_info
            }));
        })
        .catch(err => {
            dbg.warn('Error in collecting object usage stats,',
                'skipping current sampling point', err.stack || err);
            throw err;
        });
}

function get_cloud_pool_stats(req) {
    var cloud_pool_stats = _.cloneDeep(CLOUD_POOL_STATS_DEFAULTS);
    //Per each system fill out the needed info
    _.forEach(system_store.data.pools, pool => {
        cloud_pool_stats.pool_count++;
        if (pool.cloud_pool_info) {
            cloud_pool_stats.cloud_pool_count++;
            if (pool.cloud_pool_info.endpoint) {
                if (pool.cloud_pool_info.endpoint.indexOf('amazonaws.com') > -1) {
                    cloud_pool_stats.cloud_pool_target.amazon++;
                } else {
                    cloud_pool_stats.cloud_pool_target.other++;
                }
            }
        }
    });

    return cloud_pool_stats;
}

function get_tier_stats(req) {
    return _.map(system_store.data.tiers, tier => {
        let pools = [];
        _.forEach(tier.mirrors, mirror_object => {
            pools = _.concat(pools, mirror_object.spread_pools);
        });
        pools = _.compact(pools);

        return {
            pools_num: pools.length,
            data_placement: tier.data_placement,
        };
    });
}

//Collect operations related stats and usage
function get_all_stats(req) {
    //var self = this;
    var stats_payload = {
        systems_stats: null,
        nodes_stats: null,
        cloud_sync_stats: null,
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
        .then(systems_stats => {
            stats_payload.systems_stats = systems_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Nodes');
            return get_nodes_stats(req);
        })
        .then(nodes_stats => {
            stats_payload.nodes_stats = nodes_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Pools');
            return get_pool_stats(req);
        })
        .then(pools_stats => {
            stats_payload.pools_stats = pools_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Cloud Pool');
            return get_cloud_pool_stats(req);
        })
        .then(cloud_pool_stats => {
            stats_payload.cloud_pool_stats = cloud_pool_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Cloud Sync');
            return get_cloud_sync_stats(req);
        })
        .then(cloud_sync_stats => {
            stats_payload.cloud_sync_stats = cloud_sync_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Bucket Sizes');
            return get_bucket_sizes_stats(req);
        })
        .then(bucket_sizes_stats => {
            stats_payload.bucket_sizes_stats = bucket_sizes_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Object Usage');
            return get_object_usage_stats(req);
        })
        .then(object_usage_stats => {
            stats_payload.object_usage_stats = object_usage_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Tiers');
            return get_tier_stats(req);
        })
        .then(tier_stats => {
            stats_payload.tier_stats = tier_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Ops (STUB)'); //TODO
            return get_ops_stats(req);
        })
        .then(ops_stats => {
            stats_payload.ops_stats = ops_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'END');
            return stats_payload;
        })
        .catch(err => {
            dbg.warn('SYSTEM_SERVER_STATS_AGGREGATOR:', 'ERROR', err.stack);
            return {};
        });
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

function object_usage_scrubber(req) {
    let new_req = req;
    new_req.rpc_params.till_time = req.system.last_stats_report;
    return object_server.remove_s3_usage_reports(new_req)
        .then(() => {
            new_req.rpc_params.last_stats_report = Date.now();
            return system_server.set_last_stats_report_time(new_req);
        })
        .return();
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

function get_empty_sync_histo() {
    //TODO: Add histogram for limit, once implemented
    var empty_sync_histo = {};
    empty_sync_histo.histo_schedule = new Histogram('SyncSchedule(Minutes)', [{
        label: 'low',
        start_val: 0
    }, {
        label: 'med',
        start_val: 60 // 1 Hour
    }, {
        label: 'high',
        start_val: 1440 // 1 Day
    }]);

    return empty_sync_histo;
}

function get_empty_objects_histo() {
    //TODO: Add histogram for limit, once implemented
    var empty_objects_histo = {};
    empty_objects_histo.histo_size = new Histogram('Size(MegaBytes)', [{
        label: '0 MegaBytes - 5 MegaBytes',
        start_val: 0
    }, {
        label: '5 MegaBytes - 100 MegaBytes',
        start_val: 5
    }, {
        label: '100 MegaBytes - 1 GigaBytes',
        start_val: 100
    }, {
        label: '1 GigaBytes - 100 GigaBytes',
        start_val: 1000
    }, {
        label: '100 GigaBytes - 1 TeraBytes',
        start_val: 100000
    }, {
        label: '1 TeraBytes - 10 TeraBytes',
        start_val: 1000000
    }, {
        label: '10 TeraBytes - What?!',
        start_val: 10000000
    }]);

    return empty_objects_histo;
}

function background_worker() {
    if (DEV_MODE) {
        dbg.log('Central Statistics gathering disabled in DEV_MODE');
        return;
    }
    dbg.log('Central Statistics gathering enabled');
    //Run the system statistics gatheting
    return P.fcall(() => {
            let system = system_store.data.systems[0];
            let support_account = _.find(system_store.data.accounts, account => account.is_support);
            return server_rpc.client.stats.get_all_stats({}, {
                auth_token: auth_server.make_auth_token({
                    system_id: system._id,
                    role: 'admin',
                    account_id: support_account._id
                })
            });
        })
        .then(payload => send_stats_payload(payload))
        .catch(err => {
            failed_sent++;
            if (failed_sent > 5) {
                successfuly_sent_period = 0;
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
            successfuly_sent_period += config.central_stats.send_time_cycle;
            failed_sent = 0;
            if (successfuly_sent_period > config.central_stats.send_time &&
                !system_store.data.systems[0].freemium_cap.phone_home_upgraded) {
                let updates = {
                    _id: system_store.data.systems[0]._id,
                    freemium_cap: system_store.data.systems[0].freemium_cap,
                };
                updates.freemium_cap.phone_home_upgraded = true;
                updates.freemium_cap.cap_terabytes =
                    system_store.data.systems[0].freemium_cap.cap_terabytes + 10;
                return system_store.make_changes({
                    update: {
                        systems: [updates]
                    }
                });
            }
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
        .then(() => dbg.log('Phone Home data was sent successfuly'))
        .catch(err => {
            dbg.warn('Phone Home data send failed', err.stack || err);
            return;
        })
        .return();
}

// EXPORTS
//stats getters
exports.get_systems_stats = get_systems_stats;
exports.get_nodes_stats = get_nodes_stats;
exports.get_ops_stats = get_ops_stats;
exports.get_pool_stats = get_pool_stats;
exports.get_cloud_sync_stats = get_cloud_sync_stats;
exports.get_cloud_pool_stats = get_cloud_pool_stats;
exports.get_tier_stats = get_tier_stats;
exports.get_all_stats = get_all_stats;
exports.get_bucket_sizes_stats = get_bucket_sizes_stats;
exports.get_object_usage_stats = get_object_usage_stats;
//OP stats collection
exports.register_histogram = register_histogram;
exports.add_sample_point = add_sample_point;
exports.object_usage_scrubber = object_usage_scrubber;
exports.background_worker = background_worker;
