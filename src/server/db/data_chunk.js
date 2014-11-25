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

    // for mapping to storage nodes, the logical range is divided
    // into k blocks of equal size.
    // in order to support copies and/or erasure coded blocks,
    // the schema contains a list of blocks such that each one has a fragment number.
    // - blocks with (fragment < kfrag) contain real data fragment.
    // - blocks with (fragment >= kfrag) contain a computed erasure coded fragment.
    // different blocks can appear with the same fragment - which means
    // they are keeping copies of the same data block.
    kfrag: {
        type: Number,
        required: true,
    },

    md5sum: {
        type: String,
        required: true,
    }

});

data_chunk_schema.index({
    system: 1,
}, {
    unique: false
});

var DataChunk = module.exports = mongoose.model('DataChunk', data_chunk_schema);
