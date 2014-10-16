/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


var bucket_schema = new Schema({

    // the service account
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

// bucket name is unique across the entire service in order to resolve RESTful urls
bucket_schema.index({
    name: 1,
}, {
    unique: true
});

var Bucket = mongoose.model('Bucket', bucket_schema);

module.exports = Bucket;
