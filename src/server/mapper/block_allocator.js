/* jshint node:true */
'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var moment = require('moment');
var chance = require('chance')();
var config = require('../../../config.js');
var dbg = require('../../util/debug_module')(__filename);
var nodes_store = require('../stores/nodes_store');

module.exports = {
    refresh_bucket_alloc: refresh_bucket_alloc,
    refresh_pool_alloc: refresh_pool_alloc,
    allocate_node_for_block: allocate_node_for_block,
};

var pool_alloc_group = {};

function refresh_bucket_alloc(bucket) {
    let pools = _.flatten(_.map(bucket.tiering.tiers,
        tier_and_order => tier_and_order.tier.pools));
    return P.map(pools, refresh_pool_alloc);
}

function refresh_pool_alloc(pool) {
    var group =
        pool_alloc_group[pool._id] =
        pool_alloc_group[pool._id] || {
            last_refresh: new Date(0),
            nodes: [],
            aggregate: {}
        };

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
            deleted: null,
            srvmode: null,
        }, {
            sort: {
                // sorting with lowest used storage nodes first
                'storage.used': 1
            },
            limit: 100
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
    }, err => {
        group.promise = null;
        throw err;
    });

    return group.promise;
}

/**
 *
 * allocate_node_for_block
 *
 * selects distinct edge node for allocating new blocks.
 *
 * @param chunk document from db
 * @param avoid_nodes array of node ids to avoid
 *
 */
function allocate_node_for_block(block, avoid_nodes, tier, pool) {
    let chosen_pool = pool;
    if (!chosen_pool) {
        let has_any_online = false;
        let pools_online_node_count = _.map(tier.pools, pool => {
            let group = pool_alloc_group[pool._id];
            let online_nodes = group ? group.aggregate.online : 0;
            if (online_nodes) {
                has_any_online = true;
            }
            return online_nodes;
        });
        if (!has_any_online) {
            throw new Error('no online nodes in tier ' + tier.name);
        }
        // choose a pool from the tier with weights
        chosen_pool = chance.weighted(tier.pools, pools_online_node_count);
    }
    let group = pool_alloc_group[chosen_pool._id];
    let num_nodes = group ? group.nodes.length : 0;
    if (num_nodes < config.min_node_number) {
        throw new Error('not enough online online nodes in tier ' + tier.name);
    }
    for (var i = 0; i < num_nodes; ++i) {
        var node = get_round_robin(group.nodes);
        if (!_.includes(avoid_nodes, node._id.toString())) {
            dbg.log1('allocate_node_for_block: allocated node', node.name,
                'avoid_nodes', avoid_nodes);
            return node;
        }
    }
}


function get_round_robin(nodes) {
    var rr = nodes.rr || 0;
    nodes.rr = (rr + 1) % nodes.length;
    return nodes[rr];
}
