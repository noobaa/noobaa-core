/* jshint node:true */
'use strict';

var _ = require('underscore');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

// ObjectPart represents one part of an object, and exists to:
// - dedup - sharing parts between objects
// - QOS - adjust quality of service for parts of the object
//          (video first and last are more available)
// -

var object_part_schema = new Schema({

    // for mapping to storage nodes, the logical range is divided
    // into k words of equal size.
    // in order to support word copies and/or erasure coded blocks,
    // the schema contains a list of words such that each one has an index.
    // - words with (index < kwords) contain real data segment.
    // - words with (index >= kwords) contain a computed erasure coded segment.
    // the word list can contain words with the same index -
    // which means they are keeping copies.
    k: {
        type: Number,
        required: true,
    },

    size: {
        type: Number,
        required: true,
    },

});

var ObjectPart = mongoose.model('ObjectPart', object_part_schema);

module.exports = ObjectPart;
