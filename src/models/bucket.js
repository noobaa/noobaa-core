/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var _ = require('underscore');


var bucket_schema = new Schema({

    // the service account
    account: {
        type: types.ObjectId,
        ref: 'Account'
    },

    // bucket name - unique in the system
    name: String,

});

// bucket name is unique across the entire service in order to resolve RESTful urls
bucket_schema.index({
    name: 1,
}, {
    unique: true
});

var Bucket = mongoose.model('Bucket', bucket_schema);

module.exports = Bucket;
