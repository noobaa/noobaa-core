/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


/**
 *
 * OBJECT_MD SCHEMA
 *
 * the object meta-data (aka inode).
 *
 */
var objmd_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    // every object belongs to a single bucket
    bucket: {
        ref: 'Bucket',
        type: types.ObjectId,
        required: true,
    },

    // the object key is sort of a path in the bucket namespace
    key: {
        type: String,
        required: true,
    },

    // size in bytes
    size: {
        type: Number,
    },

    // upload_mode=true for objects that were created but not written yet,
    // and this means they cannot be read yet.
    upload_mode: {
        type: Boolean,
    },

    create_time: {
        type: Date,
        default: Date.now,
        required: true,
    },

});

// the combination (bucket,key) is unique
objmd_schema.index({
    bucket: 1,
    key: 1,
}, {
    unique: true
});


var ObjectMD = module.exports = mongoose.model('ObjectMD', objmd_schema);
