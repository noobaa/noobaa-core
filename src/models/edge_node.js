/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var _ = require('underscore');


var edge_node_schema = new Schema({

    // the service account
    account: {
        type: types.ObjectId,
        ref: 'Account'
    },

    // node name
    name: String,

    // the latest public ip of the node
    ip: String,

    // the listening port of the agent running on the node
    port: Number,

    // the last time the node sent heartbeat    
    hearbeat: Date,

    // the total allocation size in bytes
    allocated_storage: Number,

    // the used size in bytes - computed from the EdgeBlocks
    used_storage: Number,
});


edge_node_schema.index({
    account: 1,
    name: 1,
}, {
    unique: true
});


var EdgeNode = mongoose.model('EdgeNode', edge_node_schema);

module.exports = EdgeNode;
