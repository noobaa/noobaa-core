/* jshint node:true */
'use strict';

var _ = require('underscore');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

// DataChunk represents a part of an object, and exists to:
// - dedup - sharing chunks between objects
// - QOS - adjust quality of service for parts of the object
//          (video first and last are more available)
// - represent multiple small objects

var data_chunk_schema = new Schema({

    // for mapping to storage nodes, the logical range is divided
    // into k blocks of equal size.
    // in order to support copies and/or erasure coded blocks,
    // the schema contains a list of blocks such that each one has an index.
    // - blocks with (index < kblocks) contain real data segment.
    // - blocks with (index >= kblocks) contain a computed erasure coded segment.
    // different blocks can appear with the same index - which means
    // they are keeping copies of the same data block.
    kblocks: {
        type: Number,
        required: true,
    },

    size: {
        type: Number,
        required: true,
    },

});

var DataChunk = mongoose.model('DataChunk', data_chunk_schema);

module.exports = DataChunk;
