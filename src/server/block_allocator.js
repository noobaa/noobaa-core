/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var moment = require('moment');
var db = require('./db');
var config = require('../../config.js');


module.exports = {
    allocate_blocks: allocate_blocks,
    reallocate_bad_block: reallocate_bad_block,
    remove_blocks: remove_blocks,
};


/**
 *
 * allocate_blocks
 *
 * selects distinct edge node for allocating new blocks.
 *
 * @param blocks_info (optional) - array of objects containing:
 *      - fragment number
 *      - source block for replication
 * @return array of new DataBlock.
 */
function allocate_blocks(system, tier, blocks_info) {
    return update_tier_alloc_nodes(system, tier)
        .then(function(alloc_nodes) {
            var nodes = pop_round_robin(alloc_nodes, blocks_info.length);

            return _.map(nodes, function(node, i) {
                var info = blocks_info[i];
                var chunk = info.chunk;
                var block_size = (chunk.size / chunk.kfrag) | 0;
                var block = new_block(chunk, node, info.fragment, block_size);

                // copy the source block for building by replication - see build_chunk()
                if (info.source) {
                    block.source = info.source;
                }
                return block;
            });
        });
}


function reallocate_bad_block(chunk, bad_block) {
    return Q.when(
            bad_block.update({
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


function new_block(chunk, node, fragment, size) {
    var block = new db.DataBlock({
        fragment: fragment,
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
    var info = tier_alloc_nodes[tier.id] = tier_alloc_nodes[tier.id] || {
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
            tier: tier,
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
    if (nodes.length < config.min_node_number ) {
        throw new Error('not enough nodes: ' + nodes.length);
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
