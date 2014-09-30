/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var _ = require('underscore');


var objmap_schema = new Schema({

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

var ObjectMap = mongoose.model('ObjectMap', objmap_schema);

module.exports = ObjectMap;
