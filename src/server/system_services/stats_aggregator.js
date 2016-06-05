/**
 *
 * STATS_AGGREGATOR
 *
 */
'use strict';

const _ = require('lodash');
// const util = require('util');
const request = require('request');
const FormData = require('form-data');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const Histogram = require('../../util/histogram');
const node_server = require('../node_services/node_server');
const nodes_store = require('../node_services/nodes_store').get_instance();
const system_store = require('../system_services/system_store').get_instance();
const system_server = require('./system_server');
const promise_utils = require('../../util/promise_utils');

const ops_aggregation = {};
const SCALE_BYTES_TO_GB = 1024 * 1024 * 1024;
const SCALE_SEC_TO_DAYS = 60 * 60 * 24;

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
    objects: 0,
    roles: 0,
    allocated_space: 0,
    used_space: 0,
    total_space: 0,
    associated_nodes: {
        on: 0,
        off: 0,
    },
};

//Collect systems related stats and usage
function get_systems_stats(req) {
    var sys_stats = _.cloneDeep(SYSTEM_STATS_DEFAULTS);
    sys_stats.version = process.env.CURRENT_VERSION || 'Unknown';
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
                .then(res => _.defaults({
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
                    }
                }, SINGLE_SYS_DEFAULTS));
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
};


//Collect nodes related stats and usage
function get_nodes_stats(req) {
    var nodes_stats = _.cloneDeep(NODES_STATS_DEFAULTS);
    var nodes_histo = get_empty_nodes_histo();
    //Per each system fill out the needed info
    return P.all(_.map(system_store.data.systems,
            system => node_server.list_nodes_int(system._id)))
        .then(results => {
            for (var isys = 0; isys < results.length; ++isys) {
                for (var inode = 0; inode < results[isys].nodes.length; ++inode) {
                    nodes_stats.count++;

                    nodes_histo.histo_allocation.add_value(results[isys].nodes[inode].storage.alloc / SCALE_BYTES_TO_GB);
                    nodes_histo.histo_usage.add_value(results[isys].nodes[inode].storage.used / SCALE_BYTES_TO_GB);
                    nodes_histo.histo_free.add_value(results[isys].nodes[inode].storage.free / SCALE_BYTES_TO_GB);
                    nodes_histo.histo_uptime.add_value((results[isys].nodes[inode].os_info.uptime / SCALE_SEC_TO_DAYS));

                    if (results[isys].nodes[inode].os_info.ostype === 'Darwin') {
                        nodes_stats.os.osx++;
                    } else if (results[isys].nodes[inode].os_info.ostype === 'Windows_NT') {
                        nodes_stats.os.win++;
                    } else if (results[isys].nodes[inode].os_info.ostype === 'Linux') {
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

function get_pool_stats(req) {
    return nodes_store.aggregate_nodes_by_pool({
            deleted: null
        })
        .then(nodes_aggregate_pool => {
            return _.map(system_store.data.pools, pool => {
                var a = nodes_aggregate_pool[pool._id] || {};
                return a.count || 0;
            });
        });
}

function get_tier_stats(req) {
    return _.map(system_store.data.tiers, tier => ({
        pools_num: tier.pools.length,
        data_placement: tier.data_placement,
    }));
}

//Collect operations related stats and usage
function get_all_stats(req) {
    //var self = this;
    var stats_payload = {
        systems_stats: null,
        nodes_stats: null,
        ops_stats: null,
        pools_stats: null,
        tier_stats: null,
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
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'SENDING (STUB)'); //TODO
        })
        .then(() => {
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'END');
            return stats_payload;
        })
        .catch(err => {
            dbg.warn('SYSTEM_SERVER_STATS_AGGREGATOR:', 'ERROR', err);
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

    if (!ops_aggregation.hasOwnProperty(opname)) {
        ops_aggregation[opname] = new Histogram(master_label, structure);
    }

    dbg.log2('register_histogram registered', opname, '-', master_label, 'with', structure);
}

function add_sample_point(opname, duration) {
    if (typeof(opname) === 'undefined' || typeof(duration) === 'undefined') {
        dbg.log0('add_sample_point called with opname', opname, 'duration', duration, 'skipping sampling point');
        return;
    }

    if (!ops_aggregation.hasOwnProperty(opname)) {
        dbg.log0('add_sample_point called without histogram registered (', opname, '), skipping');
        return;
    }

    ops_aggregation[opname].add_value(duration);
}

_.noop(send_stats_payload); // lint unused bypass

function send_stats_payload(payload) {
    var form = new FormData();
    form.append('phdata', JSON.stringify(payload));

    return P.ninvoke(request, 'post', {
            url: config.central_stats.central_listener + '/phdata',
            formData: form,
            rejectUnauthorized: false,
        })
        .then((httpResponse, body) => {
            dbg.log2('Phone Home data sent successfully');
            return;
        })
        .catch(err => {
            dbg.warn('Phone Home data send failed', err.stack || err);
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

/*
 * Background Wokrer
 */
if ((config.central_stats.send_stats !== 'true') &&
    (config.central_stats.central_listener)) {
    dbg.log('Central Statistics gathering enabled');
    promise_utils.run_background_worker({
        name: 'system_server_stats_aggregator',
        batch_size: 1,
        time_since_last_build: 60000, // TODO increase...
        building_timeout: 300000, // TODO increase...
        delay: (60 * 60 * 1000), //60m

        //Run the system statistics gatheting
        run_batch: function() {
            return P.fcall(() => get_all_stats({}))
                .then(payload => {
                    //  return send_stats_payload(payload);
                })
                .catch(err => {

                });
        }
    });
}


// EXPORTS
//stats getters
exports.get_systems_stats = get_systems_stats;
exports.get_nodes_stats = get_nodes_stats;
exports.get_ops_stats = get_ops_stats;
exports.get_pool_stats = get_pool_stats;
exports.get_tier_stats = get_tier_stats;
exports.get_all_stats = get_all_stats;
//OP stats collection
exports.register_histogram = register_histogram;
exports.add_sample_point = add_sample_point;
