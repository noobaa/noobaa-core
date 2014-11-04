/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


var edge_node_schema = new Schema({

    // the service account
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

    // location - country / region
    location: {
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

    // the last time the node sent heartbeat
    heartbeat: {
        type: Date,
        default: Date.now,
        required: true,
    },

    // the allocated storage space
    allocated_storage: {
        b: Number,
        gb: Number,
    },

    // the used storage
    // computed from the data blocks owned by this node
    used_storage: {
        b: Number,
        gb: Number,
    },
});


edge_node_schema.index({
    account: 1,
    name: 1,
}, {
    unique: true
});


var EdgeNode = mongoose.model('EdgeNode', edge_node_schema);

module.exports = EdgeNode;
