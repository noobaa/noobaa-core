/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


// StoreService represents an external storage provider and related info.
//
// for example for AWS S3 the info should contain:
//  access-key, secret, region, bucket, etc.

var store_service_schema = new Schema({

    // enum of the available providers
    provider: {
        type: String,
        enum: ['s3'],
        required: true,
    },

    // the provider related info needed to access the service.
    info: {
        type: Object,
        required: true,
    },

});


var StoreService = mongoose.model('StoreService', store_service_schema);

module.exports = StoreService;
