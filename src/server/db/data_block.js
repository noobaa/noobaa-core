/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 *
 * DATA_BLOCK SCHEMA
 *
 * block is a part of a data chunk, and defines storage node.
 *
 */
var data_block_schema = new Schema({

    // system is copied from the chunk/node
    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    // tier is copied from the chunk/node
    tier: {
        ref: 'Tier',
        type: types.ObjectId,
        required: true,
    },

    // the storage node of this block
    node: {
        ref: 'Node',
        type: types.ObjectId,
        required: true,
    },

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

    // block size is "copied" from the chunk
    size: {
        type: Number,
        required: true,
    },

    // state of building block data
    // the date is build start time, removed when build completes
    building: {
        type: Date
    },

    // on delete set deletion time
    deleted: {
        type: Date
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
