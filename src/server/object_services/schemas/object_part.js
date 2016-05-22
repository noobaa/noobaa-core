/**
 *
 * OBJECT_PART SCHEMA
 *
 * connects between an object and it's data chunks.
 * allows to share data chunks between objects.
 *
 */
'use strict';

const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const types = mongoose.Schema.Types;

const object_part_schema = new Schema({

    system: {
        // ref: 'System',
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

    // the sequence number, uniquely generated in the current upload for this part
    // combined with the objectId, forms a unique identifier
    part_sequence_number: {
        type: Number,
    },

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

    // optional and temporary etag for part etag (s3). we set it for part sequence 0 during upload and remove it after.
    etag: {
        type: String,
    },

    // on delete set deletion time
    deleted: {
        type: Date
    },

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});


object_part_schema.index({
    system: 1,
    obj: 1,
    // the part number is indexed before the start offset since
    // queries that have it would be faster to filter first by part number
    // since it chops the range drastically for large files
    upload_part_number: 1,
    // we index only the start offset and not the end to save a bit
    // and use the start with both $lt and $gt when searching for ranges
    // in order to use the index efficiently and only scan the docs
    // that are indeed in the range.
    start: 1,
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


module.exports = mongoose.model('ObjectPart', object_part_schema);
