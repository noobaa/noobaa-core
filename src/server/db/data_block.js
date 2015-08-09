/* jshint node:true */
'use strict';

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

    // system is copied from the chunk/node to allow filtering
    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    // tier is copied from the node to allow filtering
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

    // the chunk redundancy layer and fragment index - see DataChunk
    // when layer==='D' this is the data layer,
    // when layer==='RS' for Reed-Solomon parity,
    // when layer==='LRC' then layer_n is the number of the LRC group.
    layer: {
        type: String,
        enum: ['D', 'RS', 'LRC'],
        required: true,
    },
    layer_n: {
        type: Number,
    },
    frag: {
        type: Number,
        required: true,
    },

    // block size is "copied" from the chunk
    size: {
        type: Number,
        required: true,
    },

    // data block message-digest - computed on the encoded fragment as stored on the node
    digest_type: {
        type: String,
        required: true,
    },
    digest_b64: {
        type: String,
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

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
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


module.exports = mongoose.model('DataBlock', data_block_schema);
