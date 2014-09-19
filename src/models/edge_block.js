/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var _ = require('underscore');


var edge_block_schema = new Schema({

    // the object map this block belongs to
    map: {
        type: types.ObjectId,
        ref: 'ObjectMap',
        required: true,
    },

    // the word index in the map
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
