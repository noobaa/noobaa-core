/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var moment = require('moment');
var db = require('./db');
var config = require('../../config.js');
var dbg = require('noobaa-util/debug_module')(__filename);


module.exports = {
    allocate_block: allocate_block,
    remove_blocks: remove_blocks,
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
function allocate_block(chunk, avoid_nodes) {
    return update_tier_alloc_nodes(chunk.system, chunk.tier)
        .then(function(alloc_nodes) {
            var block_size = (chunk.size / chunk.kfrag) | 0;
            for (var i = 0; i < alloc_nodes.length; ++i) {
                var node = pop_round_robin(alloc_nodes);
                if (!_.contains(avoid_nodes, node._id.toString())) {
                    dbg.log1('allocate_block: allocate node', node.name,
                        'for chunk', chunk._id, 'avoid_nodes', avoid_nodes);
                    return new_block(chunk, node, block_size);
                }
            }
            // we looped through all nodes and didn't find a node we can allocate
            dbg.log0('allocate_block: no available node', chunk, 'avoid_nodes', avoid_nodes);
            throw new Error('allocate_block: no available node');
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
    var block = new db.DataBlock({
        fragment: 0,
        size: size,
        building: new Date()
    });

    // using setValue as a small hack to make these fields seem populated
    // so that we can use them after returning from here.
    // this is due to a weird mongoose behavior as described by this issue:
    // https://github.com/LearnBoost/mongoose/issues/570
    block.setValue('system', chunk.system);
    block.setValue('tier', chunk.tier);
    block.setValue('chunk', chunk);
    block.setValue('node', node);
    return block;
}



var tier_alloc_nodes = {};

function update_tier_alloc_nodes(system, tier) {
    var min_heartbeat = db.Node.get_minimum_alloc_heartbeat();
    var tier_id = tier._id || tier;
    var info = tier_alloc_nodes[tier_id] = tier_alloc_nodes[tier_id] || {
        last_refresh: new Date(0),
        nodes: [],
    };

    // cache the nodes for 1 minutes and then refresh
    if (info.last_refresh >= moment().subtract(1, 'minute').toDate()) {
        return Q.resolve(info.nodes);
    }

    if (info.promise) return info.promise;

    // refresh
    info.promise =
        db.Node.find({
            system: system,
            tier: tier_id,
            deleted: null,
            heartbeat: {
                $gt: min_heartbeat
            },
            srvmode: null,
        })
        .sort({
            // sorting with lowest used storage nodes first
            'storage.used': 1
        })
        .limit(100)
        .exec()
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


// round robin - get from head and push back to tail
function pop_round_robin(nodes) {
    var node = nodes.shift();
    nodes.push(node);
    return node;
}
