/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

// data chunk is a logical chunk of data stored persistently.
// chunks are refered by object parts.
// chunks are mapped by partitioning to k data blocks.

var data_chunk_schema = new Schema({

    // chunk size in bytes
    size: {
        type: Number,
        required: true,
    },

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

});

var DataChunk = module.exports = mongoose.model('DataChunk', data_chunk_schema);
