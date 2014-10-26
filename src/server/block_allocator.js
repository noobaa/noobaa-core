/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');

// db models
var DataBlock = require('./models/data_block');
var EdgeNode = require('./models/edge_node');


module.exports = {
    allocate_blocks_for_new_chunk: allocate_blocks_for_new_chunk,
};

var COPIES = 3;

// selects distinct edge node for allocating new blocks.
//
// TODO take into consideration the state of the nodes.
//
// returns array of new DataBlock.
//
function allocate_blocks_for_new_chunk(chunk) {
    var num = chunk.kblocks * COPIES;

    return Q.fcall(
        function() {
            return EdgeNode.find().limit(num).exec();
        }
    ).then(
        function(nodes) {
            if (!nodes) {
                throw new Error('cannot find nodes');
            }
            if (nodes.length !== num) {
                throw new Error('cannot find enough nodes: ' + nodes.length + '/' + num);
            }
            var index = 0;
            var blocks = _.map(nodes, function(node) {
                var block = new DataBlock({
                    index: index,
                });
                // using setValue as a small hack to make these fields seem populated
                // so that we can use them after returning from here.
                // this is due to a weird mongoose behavior as described by this issue:
                // https://github.com/LearnBoost/mongoose/issues/570
                block.setValue('chunk', chunk);
                block.setValue('node', node);
                index = (index + 1) % chunk.kblocks;
                return block;
            });
            return blocks;
        }
    );
}
