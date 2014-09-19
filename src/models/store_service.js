/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var _ = require('underscore');


var store_service_schema = new Schema({

    provider: {
        type: String,
        enum: ['s3'],
        required: true,
    },

    bucket: {
        type: String,
        required: true,
    },

});


var StoreService = mongoose.model('StoreService', store_service_schema);

module.exports = StoreService;
