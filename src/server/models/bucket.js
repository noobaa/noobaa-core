/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


var bucket_schema = new Schema({

    // owner account
    account: {
        type: types.ObjectId,
        ref: 'Account',
        required: true,
    },

    name: {
        type: String,
        required: true,
    },

    // optional bucket global name - must be unique in the entire system
    // in order to resolve RESTful urls such as:
    //   https://www.noobaa.com/bucketname/objectkey
    global_name: {
        type: String,
    },

});


bucket_schema.index({
    account: 1,
    name: 1,
}, {
    unique: true
});

bucket_schema.index({
    global_name: 1,
}, {
    unique: true,
    // most buckets will not have a global name at all,
    // so we have to define the index sparse for the null values to not collide
    sparse: true,
});

var Bucket = module.exports = mongoose.model('Bucket', bucket_schema);
