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

    // bucket name - unique in the system
    name: {
        type: String,
        required: true,
    },

});

// bucket name is unique across the entire system in order to resolve RESTful urls
bucket_schema.index({
    name: 1,
}, {
    unique: true
});

var Bucket = module.exports = mongoose.model('Bucket', bucket_schema);
