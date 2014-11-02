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

    // the latest public ip of the node
    ip: {
        type: String,
        required: true,
    },

    // the listening port of the agent running on the node
    port: {
        type: Number,
        required: true,
    },

    // the last time the node sent heartbeat
    heartbeat: {
        type: Date,
        default: Date.now,
        required: true,
    },

    // the total allocation size in bytes
    allocated_storage: {
        type: Number,
        required: true,
    },

    // the used size in bytes
    // computed from the data blocks owned by this node
    used_storage: {
        type: Number,
        required: true,
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
