/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var _ = require('underscore');


var objmap_schema = new Schema({

    ranges: [{

        // the range starting byte offset, and byte size
        offset: Number,
        size: Number,

        // for mapping to storage nodes, the logical range is divided 
        // into 'kwords'-data-words of equal size.
        // in order to support word copies and/or erasure coded words,
        // the schema contains a list of words such that each one has an index.
        // - words with (index < kwords) contain real data segment.
        // - words with (index >= kwords) contain a computed erasure coded segment.
        // the word list can contain words with the same index - 
        // which means they are keeping copies.
        kwords: Number,
        words: [{
            index: Number,
            block: {
                type: types.ObjectId,
                ref: 'EdgeBlock'
            },
        }]

    }]

});

var ObjectMap = mongoose.model('ObjectMap', objmap_schema);

module.exports = ObjectMap;
