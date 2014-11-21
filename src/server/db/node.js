/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


var node_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    name: {
        type: String,
        required: true,
    },

    tier: {
        ref: 'Tier',
        type: types.ObjectId,
        required: true,
    },

    is_server: {
        type: Boolean,
    },

    // geolocation - country / region
    geolocation: {
        type: String,
    },

    // the public ip of the node
    ip: {
        type: String,
    },

    // the listening port of the agent running on the node
    port: {
        type: Number,
    },

    // started/stopped state for the node agent
    started: {
        type: Boolean,
    },

    // the last time the node sent heartbeat
    heartbeat: {
        type: Date,
        default: Date.now,
        required: true,
    },

    // the allocated storage space
    allocated_storage: {
        type: Number,
        required: true,
    },

    // the used storage
    // computed from the data blocks owned by this node
    used_storage: {
        type: Number,
        required: true,
    },

    // the vendor that operates this node.
    // if not specificed it means that this node is a noobaa distributed node.
    vendor: {
        ref: 'NodeVendor',
        type: types.ObjectId,
    },

    // optional vendor specific resource identifier
    vendor_node_id: {
        type: String
    },

    // device information sent by the agent.
    // TODO define schema for device_info
    device_info: {
        type: Object
    }

});


node_schema.index({
    system: 1,
    name: 1,
}, {
    unique: true
});


var Node = module.exports = mongoose.model('Node', node_schema);
