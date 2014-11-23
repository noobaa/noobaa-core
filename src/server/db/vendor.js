/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 * Vendor represents an external service vendor
 * and the related info needed to work with it.
 *
 * for example for AWS ec2 the vendor_info should contain:
 *      access-key, secret, region, etc.
 */
var vendor_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    name: {
        type: String,
        required: true,
    },

    category: {
        enum: ['vm', 'storage'],
        type: String,
        required: true,
    },

    // enum of the available vendors
    kind: {
        enum: ['agent_host', 'aws.ec2', 'aws.s3'],
        type: String,
        required: true,
    },

    // the vendor related info needed to work with it
    vendor_info: {
        type: Object,
    },

});


vendor_schema.index({
    system: 1,
    name: 1,
    category: 1,
    kind: 1,
}, {
    unique: true
});


var Vendor = module.exports = mongoose.model('Vendor', vendor_schema);
