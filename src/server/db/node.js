/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 * edge node DB model
 */
var node_schema = new Schema({

    name: {
        type: String,
        required: true,
    },

    tier: {
        ref: 'Tier',
        type: types.ObjectId,
        required: true,
    },

    // system - pulled from the tier
    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    // a manual flag for admin to mark it's servers from the rest
    is_server: {
        type: Boolean,
    },

    // geolocation - country / region
    geolocation: {
        type: String,
    },

    // the allocated storage space
    allocated_storage: {
        type: Number,
        required: true,
    },

    // the used storage computed from the data blocks owned by this node
    used_storage: {
        type: Number,
        required: true,
    },

    // ready state
    ready: {
        enum: ['verifying', 'impotent', 'sleeping', 'coma'],
        type: String,
    },

    // decomission state
    decomission: {
        enum: ['running', 'done'],
        type: String,
    },

    // malicious state
    malicious: {
        enum: ['suspected', 'malicious'],
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

    // the last time the agent sent heartbeat
    heartbeat: {
        type: Date,
        required: true,
    },

    // device information sent by the agent.
    // TODO define schema for device_info
    device_info: {
        type: Object
    },

    // on delete set deletion time
    deleted: {
        type: Date,
    },

});


node_schema.index({
    system: 1,
    name: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true
});

node_schema.index({
    vendor: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: false
});


var Node = module.exports = mongoose.model('Node', node_schema);
