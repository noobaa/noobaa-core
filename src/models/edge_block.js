/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var _ = require('underscore');


var edge_block_schema = new Schema({

    // the storage node id that keeps this word 
    node: {
        type: types.ObjectId,
        ref: 'EdgeNode'
    },

    // the length in bytes of this block
    size: Number,

});



var EdgeBlock = mongoose.model('EdgeBlock', edge_block_schema);

module.exports = EdgeBlock;
