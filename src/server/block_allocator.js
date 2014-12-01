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
var alloc_nodes;
var last_update_time_alloc_nodes;
var update_alloc_nodes_promise;

/**
 * selects distinct edge node for allocating new blocks.
 * TODO take into consideration the state of the nodes.
 *
 * @return array of new DataBlock.
 */
function allocate_blocks_for_new_chunk(chunk) {
    var num = chunk.kfrag * COPIES;
    var block_size = (chunk.size / chunk.kfrag) | 0;

    return Q.fcall(update_alloc_nodes).then(function() {

        if (!alloc_nodes) throw new Error('cannot find nodes');

        if (alloc_nodes.length < num) throw new Error(
            'cannot find enough nodes: ' +
            alloc_nodes.length + '/' + num);

        return _.times(num, function(i) {

            // round robin - get from head and push back to tail
            var node = alloc_nodes.shift();
            alloc_nodes.push(node);

            var block = new db.DataBlock({
                fragment: i % chunk.kfrag,
                size: block_size,
            });

            // using setValue as a small hack to make these fields seem populated
            // so that we can use them after returning from here.
            // this is due to a weird mongoose behavior as described by this issue:
            // https://github.com/LearnBoost/mongoose/issues/570
            block.setValue('chunk', chunk);
            block.setValue('node', node);
            return block;
        });
    });
}


function update_alloc_nodes() {
    var minimum_alloc_heartbeat = node_monitor.get_minimum_alloc_heartbeat();

    if (alloc_nodes && last_update_time_alloc_nodes >= minimum_alloc_heartbeat) return;

    if (update_alloc_nodes_promise) return update_alloc_nodes_promise;

    update_alloc_nodes_promise = Q.fcall(function() {

        // refresh the alloc_nodes
        return db.Node.find({
                started: true,
                heartbeat: {
                    $gt: minimum_alloc_heartbeat
                }
            })
            .exec();

    }).then(function(nodes) {
        alloc_nodes = nodes;
        last_update_time_alloc_nodes = new Date();
        update_alloc_nodes_promise = null;
    }, function(err) {
        update_alloc_nodes_promise = null;
    });

    return update_alloc_nodes_promise;
}
