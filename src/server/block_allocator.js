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


// selects distinct edge node for allocating new blocks.
//
// TODO take into consideration the state of the nodes.
//
// returns array of new DataBlock.
//
function allocate_blocks_for_new_chunk(chunk) {
    var num = chunk.kblocks * 3;

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
                    chunk: chunk,
                    index: index,
                    node: node.id,
                });
                index = (index + 1) % chunk.kblocks;
                return block;
            });
            return blocks;
        }
    );
}
