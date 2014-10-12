/* jshint node:true */
'use strict';

var _ = require('underscore');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


var edge_block_schema = new Schema({

    // the chunk this block belongs to
    chunk: {
        type: types.ObjectId,
        ref: 'DataChunk',
        required: true,
    },

    // the block index in the map
    index: {
        type: Number,
        required: true,
    },

    // the length in bytes of this block
    size: {
        type: Number,
        required: true,
    },

    // the storage node id that stores this block data
    node: {
        type: types.ObjectId,
        ref: 'EdgeNode',
    },

    // the store service that stores this block data
    service: {
        type: types.ObjectId,
        ref: 'StoreService',
    },

});



var EdgeBlock = mongoose.model('EdgeBlock', edge_block_schema);

module.exports = EdgeBlock;
