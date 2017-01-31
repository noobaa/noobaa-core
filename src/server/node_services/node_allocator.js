/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const chance = require('chance')();

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const nodes_client = require('./nodes_client');

const ALLOC_REFRESH_MS = 10000;

const alloc_group_by_pool = {};
const alloc_group_by_pool_set = {};


function refresh_tiering_alloc(tiering) {
    let pools = _.flatten(_.map(tiering.tiers,
        tier_and_order => {
            let tier_pools = [];
            // Inside the Tier, pools are unique and we don't need to filter afterwards
            _.forEach(tier_and_order.tier.mirrors, mirror_object => {
                tier_pools = _.concat(tier_pools, mirror_object.spread_pools);
            });
            return tier_pools;
        }));
    return P.map(pools, refresh_pool_alloc);
}

function refresh_pool_alloc(pool) {
    var group =
        alloc_group_by_pool[pool._id] =
        alloc_group_by_pool[pool._id] || {
            last_refresh: 0,
            nodes: [],
        };

    dbg.log1('refresh_pool_alloc: checking pool', pool._id, 'group', group);

    // cache the nodes for some time before refreshing
    if (Date.now() < group.last_refresh + ALLOC_REFRESH_MS) {
        return P.resolve();
    }

    if (group.promise) return group.promise;

    group.promise = P.resolve()
        .then(() => nodes_client.instance().allocate_nodes(pool.system._id, pool._id))
        .then(res => {
            group.last_refresh = Date.now();
            group.promise = null;
            group.nodes = res.nodes;
            dbg.log0('refresh_pool_alloc: updated pool', pool._id,
                'nodes', _.map(group.nodes, 'name'));
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


function get_tiering_pools_status(tiering) {
    let pools = _.flatten(_.map(tiering.tiers,
        tier_and_order => {
            let tier_pools = [];
            // Inside the Tier, pools are unique and we don't need to filter afterwards
            _.forEach(tier_and_order.tier.mirrors, mirror_object => {
                tier_pools = _.concat(tier_pools, mirror_object.spread_pools);
            });
            return tier_pools;
        }));

    return _get_tiering_pools_status(pools);
}


function _get_tiering_pools_status(pools) {
    let pools_status_by_name = {};
    _.each(pools, pool => {
        let valid_for_allocation = true;
        let alloc_group = alloc_group_by_pool[String(pool._id)];
        let num_nodes = alloc_group ? alloc_group.nodes.length : 0;
        if (pool.cloud_pool_info) {
            if (num_nodes !== config.NODES_PER_CLOUD_POOL) {
                valid_for_allocation = false;
            }
        } else if (num_nodes < config.NODES_MIN_COUNT) {
            valid_for_allocation = false;
        }
        pools_status_by_name[pool.name] = {
            valid_for_allocation: valid_for_allocation
        };
    });
    return pools_status_by_name;
}



/**
 *
 * allocate_node
 *
 * @param avoid_nodes array of node ids to avoid
 * @param content_tiering_params - in case of content tiering, the additional
 * replicas will be saved in nodes that have the best disk read latency, but only
 * from the chunk of nodes that we've received in pools.
 *
 */
function allocate_node(pools, avoid_nodes, allocated_hosts, content_tiering_params) {
    let pool_set = _.map(pools, pool => String(pool._id)).sort().join(',');
    let alloc_group =
        alloc_group_by_pool_set[pool_set] =
        alloc_group_by_pool_set[pool_set] || {
            nodes: chance.shuffle(_.flatten(_.map(pools, pool => {
                let group = alloc_group_by_pool[pool._id];
                return group && group.nodes;
            })))
        };

    // If we are allocating a node for content tiering special replicas,
    // we should run an additional sort, in order to get the best read latency nodes
    if (content_tiering_params && content_tiering_params.special_replica) {
        alloc_group.nodes = _.sortBy(alloc_group.nodes, node =>
            // In order to sort the nodes by the best read latency values.
            // We need to get the average of all the latency disk read values,
            // and sort the nodes by the average that we've calculated.
            _.sum(node.latency_of_disk_read) / node.latency_of_disk_read.length
        );
    }

    let num_nodes = alloc_group ? alloc_group.nodes.length : 0;
    dbg.log1('allocate_node: pool_set', pool_set,
        'num_nodes', num_nodes,
        'alloc_group', alloc_group);
    if (!pools[0].cloud_pool_info &&
        num_nodes < config.NODES_MIN_COUNT) { //Not cloud requires NODES_MIN_COUNT
        dbg.error('allocate_node: not enough online nodes in pool set',
            pools, avoid_nodes, allocated_hosts, content_tiering_params);
        return;
    }

    // allocate first tries from nodes with no error,
    // but if non can be found then it will try to allocate from nodes with error.
    // this allows pools with small number of nodes to overcome transient errors
    // without failing to allocate.
    // nodes with error that are indeed offline they will eventually
    // be filtered by refresh_pool_alloc.

    // on the first try, filter out nodes (drives) from hosts that already hold a similar block
    return allocate_from_list(alloc_group.nodes, avoid_nodes, allocated_hosts, {
            unique_hosts: true, // try to allocate from unique hosts first
            use_nodes_with_errors: false
        }) ||
        allocate_from_list(alloc_group.nodes, avoid_nodes, allocated_hosts, {
            unique_hosts: false, // second try - allocate from allocated hosts
            use_nodes_with_errors: false
        }) ||
        allocate_from_list(alloc_group.nodes, avoid_nodes, allocated_hosts, {
            unique_hosts: false,
            use_nodes_with_errors: true // last try - allocated also from nodes with errors
        });
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
exports.get_tiering_pools_status = get_tiering_pools_status;
exports.refresh_tiering_alloc = refresh_tiering_alloc;
exports.refresh_pool_alloc = refresh_pool_alloc;
exports.allocate_node = allocate_node;
exports.report_error_on_node_alloc = report_error_on_node_alloc;
