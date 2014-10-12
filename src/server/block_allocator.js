/* jshint node:true */
'use strict';

var _ = require('underscore');
var Q = require('q');

// db models
var EdgeNode = require('./models/edge_node');
var EdgeBlock = require('./models/edge_block');


module.exports = {
    allocate_blocks: allocate_blocks,
};


// selects distinct edge node for allocating new blocks.
//
// TODO take into consideration the state of the nodes.
//
// - existing_blocks - list of blocks aready existing for the 
//
// returns (promise) list of EdgeBlock.
//
function allocate_blocks(num, size, existing_blocks) {
    return Q.fcall(function() {
        return EdgeNode.find().limit(num).exec();
    }).then(function(nodes) {
        if (!nodes || nodes.length !== size) {
            throw new Error('not enough nodes');
        }
        var blocks = _.map(nodes, function(node) {
            return new EdgeBlock({
                node_id: node.id,
                size: size,
            });
        });
        return blocks;
    });
}
