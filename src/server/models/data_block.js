/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

// data block is a part of a data chunk, and defines storage location.

var data_block_schema = new Schema({

    // (chunk,index) define the block content
    chunk: {
        type: types.ObjectId,
        ref: 'DataChunk',
        required: true,
    },

    // the index in the chunk - see kblocks in DataChunk
    index: {
        type: Number,
        required: true,
    },

    // each block should define exactly one of these storage options.
    // blocks that are stored on multiple storage options should have
    // different blocks with same (chunk,index) to describe it.
    node: {
        type: types.ObjectId,
        ref: 'EdgeNode',
    },
    service: {
        type: types.ObjectId,
        ref: 'StoreService',
    },

});

data_block_schema.index({
    chunk: 1,
    index: 1,
}, {
    unique: false
});

data_block_schema.index({
    node: 1,
}, {
    unique: false
});

data_block_schema.pre('save', function(callback) {
    var self = this;
    var has_node = !!self.node;
    var has_service = !!self.service;
    if (has_node === has_service) {
        return callback('DataBlock must have exactly one storage (node/service)');
    }
    callback();
});


var DataBlock = mongoose.model('DataBlock', data_block_schema);

module.exports = DataBlock;
