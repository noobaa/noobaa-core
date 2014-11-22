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
 * for example for AWS S3 the vendor_info should contain:
 *      access-key, secret, region, bucket, etc.
 */
var storage_vendor_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
    },

    name: {
        type: String,
        required: true,
    },

    // enum of the available vendors
    kind: {
        enum: ['s3', 'google'],
        type: String,
        required: true,
    },

    // the vendor related info needed to work with it
    vendor_info: {
        type: Object,
    },

});

storage_vendor_schema.index({
    system: 1,
    name: 1,
}, {
    unique: true
});


var StorageVendor = module.exports = mongoose.model('StorageVendor', storage_vendor_schema);
