/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 * NodeVendor represents an external virtual-machine vendor
 * and the related info needed to work with it.
 *
 * for example for AWS ec2 the vendor_info should contain:
 *      access-key, secret, region, etc.
 */
var node_vendor_schema = new Schema({

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
        enum: ['agent_host', 'ec2'],
        type: String,
        required: true,
    },

    // the vendor related info needed to work with it
    vendor_info: {
        type: Object,
    },

});


node_vendor_schema.index({
    system: 1,
    name: 1,
}, {
    unique: true
});


var NodeVendor = module.exports = mongoose.model('NodeVendor', node_vendor_schema);
