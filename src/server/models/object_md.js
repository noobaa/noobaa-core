/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


var objmd_schema = new Schema({

    // the service account
    account: {
        type: types.ObjectId,
        ref: 'Account',
        required: true,
    },

    // every object belongs to a single bucket
    bucket: {
        type: types.ObjectId,
        ref: 'Bucket',
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

// (bucket+key) are unique in the system
objmd_schema.index({
    bucket: 1,
    key: 1,
}, {
    unique: true
});


var ObjectMD = mongoose.model('ObjectMD', objmd_schema);

module.exports = ObjectMD;
