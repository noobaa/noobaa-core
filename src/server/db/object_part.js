/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 *
 * OBJECT_PART SCHEMA
 *
 * connects between an object and it's data chunks.
 * allows to share data chunks between objects.
 *
 */
var object_part_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    // the object that this part belong to.
    obj: {
        type: types.ObjectId,
        ref: 'ObjectMD',
        required: true,
    },

    // the range [start,end) in the object
    start: {
        type: Number,
        required: true,
    },

    // we prefer to keep the end offset instead of size to allow querying the
    // object for specific offsets and get the relevant parts.
    // end must equal to (start + chunk.size)
    end: {
        type: Number,
        required: true,
    },

    // the part number as used for s3 multipart upload api
    // this will be kept during upload only to be able to list the parts
    // and group them by the caller part numbers
    upload_part_number: {
        type: Number,
    },

    // list of chunks (copies)
    chunks: [{

        // link to the data chunk, which might be shared by
        // several parts by different objects for dedup.
        chunk: {
            type: types.ObjectId,
            ref: 'DataChunk',
            required: true,
        },

        // optional offset inside the chunk, used for small files sharing the chunk
        chunk_offset: {
            type: Number,
        },
    }],

    // on delete set deletion time
    deleted: {
        type: Date
    },

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});


object_part_schema.index({
    obj: 1,
    start: 1,
    end: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: false
});

object_part_schema.index({
    chunk: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: false
});

object_part_schema.index({
    system: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: false
});


var ObjectPart = module.exports = mongoose.model('ObjectPart', object_part_schema);
