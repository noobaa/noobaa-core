/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


/**
 * StorageVendor represents an external object storage vendor
 * and the related info needed to work with it.
 *
 * for example for AWS S3 the info should contain:
 *      access-key, secret, region, bucket, etc.
 */
var storage_vendor_schema = new Schema({

    // enum of the available vendors
    kind: {
        type: String,
        enum: ['s3', 'google'],
        required: true,
    },

    // the vendor related info needed to work with it
    info: {
        type: Object,
        required: true,
    },

});


var StorageVendor = module.exports = mongoose.model('StorageVendor', storage_vendor_schema);
