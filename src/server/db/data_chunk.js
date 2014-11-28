/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 * data chunk DB model.
 * is a logical chunk of data stored persistently.
 * chunks are refered by object parts.
 * chunks are mapped by partitioning to k data blocks.
 */
var data_chunk_schema = new Schema({

    // the storage tier of this chunk
    tier: {
        ref: 'Tier',
        type: types.ObjectId,
        required: true,
    },

    // system - pulled from the tier
    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    // chunk size in bytes
    size: {
        type: Number,
        required: true,
    },

    md5sum: {
        type: String,
    },

    // for mapping to edge nodes, the logical range is divided
    // into k fragments of equal size.
    // in order to support copies and/or erasure coded blocks,
    // the schema contains a list of blocks such that each one has a fragment number.
    // - blocks with (fragment < kfrag) contain real data fragment.
    // - blocks with (fragment >= kfrag) contain a computed erasure coded fragment.
    // different blocks appearing with the same fragment - means they are copies
    // of the same data fragment.
    kfrag: {
        type: Number,
    },

    // on delete set deletion time
    deleted: {
        type: Date
    },

});

data_chunk_schema.index({
    system: 1,
    tier: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: false
});

var DataChunk = module.exports = mongoose.model('DataChunk', data_chunk_schema);
