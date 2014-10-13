/* jshint node:true */
'use strict';

var _ = require('underscore');
var Q = require('q');

// db models
var DataBlock = require('./models/data_block');
var EdgeNode = require('./models/edge_node');


module.exports = {
    allocate_blocks: allocate_blocks,
};


// selects distinct edge node for allocating new blocks.
//
// TODO take into consideration the state of the nodes.
//
// - existing_blocks - list of blocks aready existing for the
//
// returns (promise) list of DataBlock.
//
function allocate_blocks(num, size, existing_blocks) {
    return Q.fcall(function() {
        return EdgeNode.find().limit(num).exec();
    }).then(function(nodes) {
        if (!nodes || nodes.length !== size) {
            throw new Error('not enough nodes');
        }
        var blocks = _.map(nodes, function(node) {
            return new DataBlock({
                node_id: node.id,
                size: size,
            });
        });
        return blocks;
    });
}
