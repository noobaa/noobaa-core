/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 * data block DB model.
 * is a part of a data chunk, and defines storage node.
 */
var data_block_schema = new Schema({

    // (chunk,fragment) define the block content
    chunk: {
        ref: 'DataChunk',
        type: types.ObjectId,
        required: true,
    },

    // the fragment in the chunk - see kfrag in DataChunk
    fragment: {
        type: Number,
        required: true,
    },

    // the storage node of this block
    node: {
        ref: 'Node',
        type: types.ObjectId,
        required: true,
    },

    // system - pulled from the chunk
    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    // tier - pulled from the chunk
    tier: {
        ref: 'Tier',
        type: types.ObjectId,
        required: true,
    },


    // block size - pulled from the chunk
    size: {
        type: Number,
        required: true,
    },

    // on delete set deletion time
    deleted: {
        type: Date,
    },

});

data_block_schema.index({
    chunk: 1,
    fragment: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: false
});

data_block_schema.index({
    system: 1,
    tier: 1,
    node: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: false
});


var DataBlock = module.exports = mongoose.model('DataBlock', data_block_schema);
