/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var _ = require('underscore');


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

    maps: [{
        // the range starting byte offset, and byte size
        offset: {
            type: Number,
            required: true,
        },
        size: {
            type: Number,
            required: true,
        },
        // the object storage mapping can be shared between multiple objects in the system
        map: {
            type: types.ObjectId,
            ref: 'ObjectMap',
            required: true,
        },
    }],

    // size in bytes
    size: {
        type: Number,
        required: true,
    },

    create_time: {
        type: Date,
        default: Date.now,
        required: true,
    },

});

objmd_schema.index({
    bucket: 1,
    key: 1,
}, {
    unique: true
});


var ObjectMD = mongoose.model('ObjectMD', objmd_schema);

module.exports = ObjectMD;
