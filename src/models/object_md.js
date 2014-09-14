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
        ref: 'Account'
    },

    // every object belongs to a single bucket
    bucket: {
        type: types.ObjectId,
        ref: 'Bucket'
    },
    
    // the object key is sort of a path in the bucket namespace
    key: String,

    // the object storage mapping can be shared between multiple objects in the system
    map: {
        type: types.ObjectId,
        ref: 'ObjectMap'
    },

    // size in bytes
    size: Number,

    create_time: {
        type: Date,
        default: Date.now
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
