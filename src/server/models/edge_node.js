/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


var edge_node_schema = new Schema({

    // owner account
    account: {
        type: types.ObjectId,
        ref: 'Account',
        required: true,
    },

    // node name
    name: {
        type: String,
        required: true,
    },

    // geolocation - country / region
    geolocation: {
        type: String,
        required: true,
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
        required: true,
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
        type: types.ObjectId,
        ref: 'NodeVendor',
    },
    // optional vendor specific resource identifier
    vendor_node_id: {
        type: String
    },
    // desired state - true=started, false=stopped
    vendor_node_desired_state: {
        type: Boolean
    },

    // system information sent by the agent.
    // TODO no schema yet for system_info
    system_info: {
        os: {}
    }

});


edge_node_schema.index({
    account: 1,
    name: 1,
}, {
    unique: true
});


var EdgeNode = module.exports = mongoose.model('EdgeNode', edge_node_schema);
