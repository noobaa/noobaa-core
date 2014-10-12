/* jshint node:true */
'use strict';

var _ = require('underscore');
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
    },

    // the listening port of the agent running on the node
    port: {
        type: Number,
    },

    // the last time the node sent heartbeat
    hearbeat: {
        type: Date,
    },

    // the total allocation size in bytes
    allocated_storage: {
        type: Number,
    },

    // the used size in bytes - computed from the EdgeBlocks
    used_storage: {
        type: Number,
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
