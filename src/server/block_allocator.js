/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var moment = require('moment');
var node_monitor = require('./node_monitor');
var db = require('./db');


module.exports = {
    allocate_blocks_for_new_chunk: allocate_blocks_for_new_chunk,
};

var COPIES = 3;

/**
 * selects distinct edge node for allocating new blocks.
 * TODO take into consideration the state of the nodes.
 *
 * @return array of new DataBlock.
 */
function allocate_blocks_for_new_chunk(chunk) {
    var num = chunk.kfrag * COPIES;
    var block_size = (chunk.size / chunk.kfrag) | 0;

    return update_tier_alloc_nodes(chunk.system, chunk.tier)
        .then(function(nodes) {

            if (nodes.length < num) throw new Error(
                'cannot find enough nodes: ' +
                nodes.length + '/' + num);

            return _.times(num, function(i) {

                // round robin - get from head and push back to tail
                var node = nodes.shift();
                nodes.push(node);

                var block = new db.DataBlock({
                    fragment: i % chunk.kfrag,
                    size: block_size,
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
            });
        });
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
            // disabled: false,
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
