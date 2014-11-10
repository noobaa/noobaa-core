/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var moment = require('moment');

// db models
var DataBlock = require('./models/data_block');
var EdgeNode = require('./models/edge_node');


module.exports = {
    allocate_blocks_for_new_chunk: allocate_blocks_for_new_chunk,
};

var COPIES = 3;
var alloc_nodes;
var last_update_time_alloc_nodes;
var update_alloc_nodes_promise;

// selects distinct edge node for allocating new blocks.
//
// TODO take into consideration the state of the nodes.
//
// returns array of new DataBlock.
//
function allocate_blocks_for_new_chunk(chunk) {
    var num = chunk.kblocks * COPIES;

    return Q.fcall(update_alloc_nodes).then(
        function() {
            if (!alloc_nodes) {
                throw new Error('cannot find nodes');
            }
            if (alloc_nodes.length < num) {
                throw new Error('cannot find enough nodes: ' + alloc_nodes.length + '/' + num);
            }
            var blocks = _.times(num, function(i) {
                // round robin - get from head and push back to tail
                var node = alloc_nodes.shift();
                alloc_nodes.push(node);

                var block = new DataBlock({
                    index: i % chunk.kblocks,
                });
                // using setValue as a small hack to make these fields seem populated
                // so that we can use them after returning from here.
                // this is due to a weird mongoose behavior as described by this issue:
                // https://github.com/LearnBoost/mongoose/issues/570
                block.setValue('chunk', chunk);
                block.setValue('node', node);
                return block;
            });
            return blocks;
        }
    );
}


function update_alloc_nodes() {
    var minimum_time_for_alloc = moment().subtract(2, 'minutes');
    if (alloc_nodes && last_update_time_alloc_nodes &&
        last_update_time_alloc_nodes.isAfter(minimum_time_for_alloc)) {
        return;
    }
    if (!update_alloc_nodes_promise) {
        update_alloc_nodes_promise = Q.fcall(
            function() {
                return EdgeNode.find({
                    heartbeat: {
                        $gt: minimum_time_for_alloc.toDate()
                    }
                }).exec();
            }
        ).then(
            function(nodes) {
                alloc_nodes = nodes;
                last_update_time_alloc_nodes = moment();
                update_alloc_nodes_promise = null;
            },
            function(err) {
                update_alloc_nodes_promise = null;
            }
        );
    }
    return update_alloc_nodes_promise;
}
