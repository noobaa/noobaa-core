/* jshint node:true */
'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var moment = require('moment');
var chance = require('chance')();
var config = require('../../../config.js');
var dbg = require('../../util/debug_module')(__filename);
var nodes_store = require('../stores/nodes_store');

exports.refresh_tiering_alloc = refresh_tiering_alloc;
exports.refresh_pool_alloc = refresh_pool_alloc;
exports.allocate_node = allocate_node;
exports.report_node_error = report_node_error;

var alloc_group_by_pool = {};
var alloc_group_by_pool_set = {};

function refresh_tiering_alloc(tiering) {
    let pools = _.flatten(_.map(tiering.tiers,
        tier_and_order => tier_and_order.tier.pools));
    return P.map(pools, refresh_pool_alloc);
}

function refresh_pool_alloc(pool) {
    var group =
        alloc_group_by_pool[pool._id] =
        alloc_group_by_pool[pool._id] || {
            last_refresh: new Date(0),
            nodes: [],
            aggregate: {}
        };

    dbg.log1('refresh_pool_alloc: checking pool', pool._id, 'group', group);

    // cache the nodes for 1 minutes and then refresh
    if (group.last_refresh >= moment().subtract(1, 'minute').toDate()) {
        return P.resolve();
    }

    if (group.promise) return group.promise;

    group.promise = P.join(
        nodes_store.find_nodes({
            system: pool.system._id,
            pool: pool._id,
            heartbeat: {
                $gt: nodes_store.get_minimum_alloc_heartbeat()
            },
            'storage.free': {
                $gt: config.NODES_FREE_SPACE_RESERVE
            },
            deleted: null,
            srvmode: null,
        }, {
            fields: nodes_store.NODE_FIELDS_FOR_MAP,
            sort: {
                // sorting with lowest used storage nodes first
                'storage.used': 1
            },
            limit: 1000
        }),
        nodes_store.aggregate_nodes_by_pool({
            system: pool.system._id,
            pool: pool._id,
            deleted: null,
        })
    ).spread((nodes, nodes_aggregate_pool) => {
        group.last_refresh = new Date();
        group.promise = null;
        group.nodes = nodes;
        group.aggregate = nodes_aggregate_pool[pool._id];
        dbg.log1('refresh_pool_alloc: updated pool', pool._id,
            'nodes', group.nodes, 'aggregate', group.aggregate);
        _.each(alloc_group_by_pool_set, (g, pool_set) => {
            if (_.includes(pool_set, pool._id.toString())) {
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
function allocate_node(pools, avoid_nodes, content_tiering_params) {
    let pool_set = _.map(pools, pool => pool._id.toString()).sort().join(',');
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
    if (pools[0].cloud_pool_info) {
        if (num_nodes !== config.NODES_PER_CLOUD_POOL) {
            throw new Error('allocate_node: cloud_pool allocations should have only one node (cloud node)');
        }
    } else if (num_nodes < config.NODES_MIN_COUNT) {
        throw new Error('allocate_node: not enough online nodes in pool set ' + pool_set);
    }

    // allocate first tries from nodes with no error,
    // but if non can be found then it will try to allocate from nodes with error.
    // this allows pools with small number of nodes to overcome transient errors
    // without failing to allocate.
    // nodes with error that are indeed offline they will eventually
    // be filtered by refresh_pool_alloc.
    return allocate_from_list(alloc_group.nodes, avoid_nodes, false) ||
        allocate_from_list(alloc_group.nodes, avoid_nodes, true);
}

function allocate_from_list(nodes, avoid_nodes, use_nodes_with_errors) {
    for (var i = 0; i < nodes.length; ++i) {
        var node = get_round_robin(nodes);
        if (Boolean(use_nodes_with_errors) === Boolean(node.error_since_hb) &&
            !_.includes(avoid_nodes, node._id.toString())) {
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
function report_node_error(node_id) {
    _.each(alloc_group_by_pool, (group, pool_id) => {
        _.each(group.nodes, node => {
            if (String(node._id) === String(node_id)) {
                node.error_since_hb = new Date();
            }
        });
    });
}
