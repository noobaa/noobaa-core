/* jshint node:true */
'use strict';

var _ = require('underscore');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


var object_part_schema = new Schema({

    obj: {
        type: types.ObjectId,
        ref: 'ObjectMD',
        required: true,
    },

    chunk: {
        type: types.ObjectId,
        ref: 'DataChunk',
        required: true,
    },

    // the range (offset,size) in the object
    offset: {
        type: Number,
        required: true,
    },

    size: {
        type: Number,
        required: true,
    },

    // optional offset inside the chunk, used for small files sharing the chunk
    chunk_offset: {
        type: Number,
    },

});

object_part_schema.index({
    obj: 1,
    chunk: 1,
    offset: 1,
}, {
    unique: false
});


var ObjectPart = mongoose.model('ObjectPart', object_part_schema);

module.exports = ObjectPart;
