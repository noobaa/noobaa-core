/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const chance = require('chance')();
// const util = require('util');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const nodes_client = require('./nodes_client');
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
// const node_server = require('./node_server');

const ALLOC_REFRESH_MS = 10000;

let alloc_group_by_pool = {};
let alloc_group_by_pool_set = {};
let alloc_group_by_tiering = {};


async function refresh_tiering_alloc(tiering, force) {
    const pools = _.flatMap(tiering.tiers, ({ tier }) => {
        let tier_pools = [];
        // Inside the Tier, pools are unique and we don't need to filter afterwards
        _.forEach(tier.mirrors, mirror_object => {
            tier_pools = _.concat(tier_pools, mirror_object.spread_pools);
        });
        return tier_pools;
    });
    if (force === 'force') {
        const timestamp = Date.now();
        await server_rpc.client.node.sync_monitor_storage_info(undefined, {
            auth_token: auth_server.make_auth_token({
                system_id: tiering.system._id,
                role: 'admin'
            })
        });
        dbg.log0('ZZZZ refresh_tiering_alloc -> sync_monitor_to_store took', Date.now() - timestamp);
    }
    return P.join(
        P.map(pools, pool => refresh_pool_alloc(pool, force)),
        refresh_tiers_alloc(tiering, force),
    );
}

function refresh_pool_alloc(pool, force) {
    let group = alloc_group_by_pool[pool._id];
    if (!group) {
        group = {
            last_refresh: 0,
            nodes: [],
        };
        alloc_group_by_pool[pool._id] = group;
    }

    dbg.log2('refresh_pool_alloc: checking pool', pool._id, 'group', group);

    if (force !== 'force') {
        // cache the nodes for some time before refreshing
        if (Date.now() < group.last_refresh + ALLOC_REFRESH_MS) {
            return P.resolve();
        }
    }

    if (group.promise) return group.promise;

    group.promise = P.resolve()
        .then(() => nodes_client.instance().allocate_nodes(pool.system._id, pool._id))
        .then(res => {
            group.last_refresh = Date.now();
            group.promise = null;
            group.latency_groups = res.latency_groups;
            dbg.log0('refresh_pool_alloc: updated pool', pool.name,
                'nodes', _.map(_.flatMap(group.latency_groups, 'nodes'), 'name'));
            _.each(alloc_group_by_pool_set, (g, pool_set) => {
                if (_.includes(pool_set, String(pool._id))) {
                    dbg.log0('invalidate alloc_group_by_pool_set for', pool_set,
                        'on change to pool', pool._id);
                    delete alloc_group_by_pool_set[pool_set];
                }
            });
        }, err => {
            group.promise = null;
            throw err;
        });

    return group.promise;
}


function refresh_tiers_alloc(tiering, force) {

    let group = alloc_group_by_tiering[tiering._id];
    if (!group) {
        group = {
            last_refresh: 0,
            mirrors_storage_by_tier_id: {}
        };
        alloc_group_by_tiering[tiering._id] = group;
    }

    dbg.log1('refresh_tier_alloc: checking tiering', tiering._id, 'group', group);

    if (force !== 'force') {
        // cache the nodes for some time before refreshing
        if (Date.now() < group.last_refresh + ALLOC_REFRESH_MS) {
            return P.resolve();
        }
    }

    if (group.promise) return group.promise;

    group.promise = P.resolve()
        .then(() => nodes_client.instance().aggregate_data_free_by_tier(
            _.map(tiering.tiers, tier_and_order => String(tier_and_order.tier._id)),
            _.sample(tiering.tiers).tier.system._id
        ))
        .then(res => {
            group.last_refresh = Date.now();
            group.promise = null;
            group.mirrors_storage_by_tier_id = res;
        }, err => {
            group.promise = null;
            throw err;
        });

    return group.promise;
}


function get_tiering_status(tiering) {
    let tiering_status_by_tier = {};
    _.each(tiering.tiers, ({ tier }) => {
        let tier_pools = [];
        // Inside the Tier, pools are unique and we don't need to filter afterwards
        _.each(tier.mirrors, mirror_object => {
            tier_pools = _.concat(tier_pools, mirror_object.spread_pools);
        });

        const ccc = _.get(tier, 'chunk_config.chunk_coder_config');
        const required_valid_nodes = ccc ? (ccc.data_frags + ccc.parity_frags) * ccc.replicas : config.NODES_MIN_COUNT;
        tiering_status_by_tier[tier._id] = {
            pools: _get_tier_pools_status(tier_pools, required_valid_nodes),
            mirrors_storage: _.get(alloc_group_by_tiering, `${tiering._id}.mirrors_storage_by_tier_id.${tier._id}`),
        };
    });
    return tiering_status_by_tier;
}

function _get_tier_pools_status(pools, required_valid_nodes) {
    let pools_status_by_id = {};
    _.each(pools, pool => {
        let valid_for_allocation = true;
        let alloc_group = alloc_group_by_pool[String(pool._id)];
        const num_nodes = alloc_group ? _.sumBy(alloc_group.latency_groups, 'nodes.length') : 0;
        if (pool.cloud_pool_info) {
            if (num_nodes !== config.NODES_PER_CLOUD_POOL) {
                valid_for_allocation = false;
            }
        } else if (pool.mongo_pool_info) {
            if (num_nodes !== config.NODES_PER_MONGO_POOL) {
                valid_for_allocation = false;
            }
        } else if (num_nodes < required_valid_nodes) {
            valid_for_allocation = false;
        }
        pools_status_by_id[pool._id] = {
            valid_for_allocation,
            num_nodes,
            resource_type: pool.resource_type
        };
    });
    return pools_status_by_id;
}



/**
 *
 * allocate_node
 *
 * @param avoid_nodes array of node ids to avoid
 *
 */
function allocate_node(pools, avoid_nodes, allocated_hosts) {
    let pool_set = _.map(pools, pool => String(pool._id)).sort().join(',');
    let alloc_group = alloc_group_by_pool_set[pool_set];

    if (!alloc_group) {
        const pools_latency_groups = [{ nodes: [] }];
        // TODO:
        // We allocate using pool sets and not single pools
        // This is why we need to somehow merge the KMEANS of each pool into an aggregated pool set
        // It is a problem which breaks the KMEANS groups since we just merge the groups by index
        // Example of the problematic case:
        // Pool A: Has 20 slow nodes (It will be divided to 2 slow groups)
        // Pool B: Has 20 fast nodes (It will be divided to 2 fast groups)
        // Since we will merge the two groups we will eventually have two average groups
        // This is bad since we will have two groups with each having fast and slow drives
        pools.forEach(pool => {
            let group = alloc_group_by_pool[pool._id];
            if (group && group.latency_groups) {
                group.latency_groups.forEach((value, index) => {
                    if (pools_latency_groups[index]) {
                        pools_latency_groups[index].nodes =
                            _.concat(pools_latency_groups[index].nodes, value.nodes);
                    } else {
                        pools_latency_groups[index] = value;
                    }
                });
            }
        });
        alloc_group = {
            latency_groups: _.map(pools_latency_groups, group => ({
                nodes: chance.shuffle(group.nodes)
            }))
        };
        alloc_group_by_pool_set[pool_set] = alloc_group;
    }

    const num_nodes = alloc_group ? _.sumBy(alloc_group.latency_groups, 'nodes.length') : 0;

    dbg.log1('allocate_node: pool_set', pool_set,
        'num_nodes', num_nodes,
        'alloc_group', alloc_group);

    if (num_nodes < 1) {
        // await P.map(pools, pool => refresh_pool_alloc(pool, 'force'));
        dbg.error('allocate_node: no nodes for allocation in pool set',
            pools, avoid_nodes, allocated_hosts);
        return;
    }

    const ALLOC_BEST = { unique_hosts: true, use_nodes_with_errors: false };
    const ALLOC_ALLOW_SAME_HOST = { unique_hosts: false, use_nodes_with_errors: false };
    const ALLOC_ALLOW_ANY = { unique_hosts: false, use_nodes_with_errors: true };

    let node;
    alloc_group.latency_groups.forEach(group => {
        if (node) return false; // This is done in order to break the loop
        node = allocate_from_list(group.nodes, avoid_nodes, allocated_hosts, ALLOC_BEST) ||
            allocate_from_list(group.nodes, avoid_nodes, allocated_hosts, ALLOC_ALLOW_SAME_HOST);
    });
    if (node) return node;
    alloc_group.latency_groups.forEach(group => {
        if (node) return false; // This is done in order to break the loop
        node = allocate_from_list(group.nodes, avoid_nodes, allocated_hosts, ALLOC_ALLOW_ANY);
    });
    return node;
}


function allocate_from_list(nodes, avoid_nodes, allocated_hosts, options) {
    for (var i = 0; i < nodes.length; ++i) {
        var node = get_round_robin(nodes);
        if (Boolean(options.use_nodes_with_errors) ===
            Boolean(node.report_error_on_node_alloc) &&
            !_.includes(avoid_nodes, String(node._id)) &&
            (!_.includes(allocated_hosts, node.host_id) || !options.unique_hosts)) {
            dbg.log1('allocate_node: allocated node', node.name,
                'avoid_nodes', avoid_nodes);
            return node;
        }
    }
}

function get_round_robin(nodes) {
    var rr = (nodes.rr || 0) % nodes.length;
    nodes.rr = rr + 1;
    return nodes[rr];
}

/**
 * find the node in the memory groups and mark the error time
 */
function report_error_on_node_alloc(node_id) {
    _.each(alloc_group_by_pool, (group, pool_id) => {
        _.each(group.nodes, node => {
            if (String(node._id) === String(node_id)) {
                node.report_error_on_node_alloc = new Date();
            }
        });
    });
}


// EXPORTS
exports.get_tiering_status = get_tiering_status;
exports.refresh_tiering_alloc = refresh_tiering_alloc;
exports.refresh_pool_alloc = refresh_pool_alloc;
exports.allocate_node = allocate_node;
exports.report_error_on_node_alloc = report_error_on_node_alloc;
