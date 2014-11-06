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
 * for example for AWS opworks the info should contain:
 *      access-key, secret, region, etc.
 */
var node_vendor_schema = new Schema({

    // enum of the available vendors
    kind: {
        type: String,
        enum: ['agent-host', 'aws-opworks'],
        required: true,
    },

    // the vendor related info needed to work with it
    info: {
        type: Object,
    },

});

var NodeVendor = module.exports = mongoose.model('NodeVendor', node_vendor_schema);
