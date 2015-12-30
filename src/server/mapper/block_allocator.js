/* jshint node:true */
'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var moment = require('moment');
var db = require('../db');
var config = require('../../../config.js');
var dbg = require('../../util/debug_module')(__filename);


module.exports = {
    allocate_block: allocate_block,
    remove_blocks: remove_blocks,
    get_block_md: get_block_md,
};


/**
 *
 * allocate_blocks
 *
 * selects distinct edge node for allocating new blocks.
 *
 * @param chunk document from db
 * @param avoid_nodes array of node ids to avoid
 *
 */
function allocate_block(chunk, avoid_nodes, pools) {
    return update_tier_alloc_nodes(chunk.system, chunk.tier, pools)
        .then(function(alloc_nodes) {
            var block_size = (chunk.size / chunk.kfrag) | 0;
            for (var i = 0; i < alloc_nodes.length; ++i) {
                var node = get_round_robin(alloc_nodes);
                if (!_.contains(avoid_nodes, node._id.toString())) {
                    dbg.log1('allocate_block: allocate node', node.name,
                        'for chunk', chunk._id, 'avoid_nodes', avoid_nodes);
                    return new_block(chunk, node, block_size);
                }
            }
            // we looped through all nodes and didn't find a node we can allocate
            dbg.log0('allocate_block: no available node', chunk, 'avoid_nodes', avoid_nodes);
            return null;
        });
}


function remove_blocks(blocks) {
    return db.DataBlock.update({
        _id: {
            $in: _.pluck(blocks, '_id')
        }
    }, {
        deleted: new Date()
    }, {
        multi: true
    }).exec();
}


function new_block(chunk, node, size) {
    return /*new db.DataBlock*/ ({
        _id: db.new_object_id(),
        system: chunk.system,
        tier: node.tier,
        chunk: chunk,
        node: node,
        layer: 'D',
        frag: 0,
        size: size,
        // always allocate in building mode
        building: new Date()
    });
}

var tier_alloc_nodes = {};

function update_tier_alloc_nodes(system, tier, pools) {
    var tier_id = (tier && tier._id) || tier || null;
    var info = tier_alloc_nodes[tier_id] = tier_alloc_nodes[tier_id] || {
        last_refresh: new Date(0),
        nodes: [],
    };

    // cache the nodes for 1 minutes and then refresh
    if (info.last_refresh >= moment().subtract(1, 'minute').toDate()) {
        return P.resolve(info.nodes);
    }

    if (info.promise) return info.promise;

    // refresh
    info.promise = P.when(get_associated_nodes(system, pools))
        .then(function(nodes) {
            info.promise = null;
            info.nodes = nodes;
            if (nodes.length < config.min_node_number) {
                throw new Error('not enough nodes: ' + nodes.length);
            }
            info.last_refresh = new Date();
            return nodes;
        }, function(err) {
            info.promise = null;
            throw err;
        });

    return info.promise;
}

function get_associated_nodes(system, pools) {
    var min_heartbeat = db.Node.get_minimum_alloc_heartbeat();
    var associated_nodes = [];
    return P.when(db.Pool
            .find({
                _id: {
                    $in: _.flatten(pools),
                }
            })
            .exec())
        .then(function(res_pools) {
            _.each(res_pools, function(p) {
                if (p.nodes.length !== 0) {
                    associated_nodes = associated_nodes.concat(p.nodes);
                }
            });
            return associated_nodes;
        })
        .then(function() {
            var q = {
                system: system,
                deleted: null,
                name: {
                    $in: associated_nodes
                },
                heartbeat: {
                    $gt: min_heartbeat
                },
                srvmode: null,
            };

            return P.when(db.Node.find(q)
                .sort({
                    // sorting with lowest used storage nodes first
                    'storage.used': 1
                })
                .limit(100)
                .exec());
        });
}


function get_round_robin(nodes) {
    var rr = nodes.rr || 0;
    nodes.rr = (rr + 1) % nodes.length;
    return nodes[rr];
}

function get_block_md(block) {
    var b = _.pick(block, 'size', 'digest_type', 'digest_b64');
    b.id = block._id.toString();
    b.address = block.node.rpc_address;
    return b;
}
