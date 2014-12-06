/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var moment = require('moment');
var node_monitor = require('./node_monitor');
var db = require('./db');


module.exports = {
    allocate_blocks_for_new_chunk: allocate_blocks_for_new_chunk,
    reallocate_bad_block: reallocate_bad_block,
};

var COPIES = 3;

/**
 * selects distinct edge node for allocating new blocks.
 * TODO take into consideration the state of the nodes.
 *
 * @return array of new DataBlock.
 */
function allocate_blocks_for_new_chunk(chunk) {
    var count = chunk.kfrag * COPIES;
    var block_size = (chunk.size / chunk.kfrag) | 0;

    return update_tier_alloc_nodes(chunk.system, chunk.tier)
        .then(function(alloc_nodes) {
            var nodes = pop_round_robin(alloc_nodes, count);
            return _.map(nodes, function(node, i) {
                return new_block(chunk, node, i % chunk.kfrag, block_size);
            });
        });
}


function reallocate_bad_block(chunk, bad_block) {
    return Q.when(db.DataBlock
            .findByIdAndUpdate(bad_block.id, {
                deleted: new Date()
            })
            .exec())
        .then(function() {
            return update_tier_alloc_nodes(chunk.system, chunk.tier);
        })
        .then(function(alloc_nodes) {
            var nodes = pop_round_robin(alloc_nodes, 1);
            return new_block(chunk, nodes[0], bad_block.fragment, bad_block.size);
        });
}



function new_block(chunk, node, fragment, size) {
    var block = new db.DataBlock({
        fragment: fragment,
        size: size,
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
    var min_heartbeat = node_monitor.get_minimum_alloc_heartbeat();
    var info = tier_alloc_nodes[tier.id] = tier_alloc_nodes[tier.id] || {
        last_refresh: new Date(0),
        nodes: [],
    };

    if (info.last_refresh >= min_heartbeat) return Q.resolve(info.nodes);
    if (info.promise) return info.promise;

    // refresh
    info.promise =
        db.Node.find({
            system: system,
            tier: tier,
            deleted: null,
            heartbeat: {
                $gt: min_heartbeat
            },
            disabled: {
                $ne: true
            },
        })
        .exec()
        .then(function(nodes) {
            info.promise = null;
            info.last_refresh = new Date();
            info.nodes = nodes;
            return nodes;
        }, function(err) {
            info.promise = null;
            throw err;
        });

    return info.promise;
}


function pop_round_robin(nodes, count) {
    if (nodes.length < count) {
        throw new Error('cannot find enough nodes: ' + nodes.length + '/' + count);
    }

    var ret = [];

    for (var i = 0; i < count; i++) {
        // round robin - get from head and push back to tail
        var node = nodes.shift();
        nodes.push(node);
        ret.push(node);
    }

    return ret;
}
