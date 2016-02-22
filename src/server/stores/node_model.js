/* jshint node:true */
'use strict';

// var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
// var size_utils = require('../../util/size_utils');

// schema of storage info for node/srive
var storage_stat_schema = {

    // total amount of storage space on the node/drive
    total: {
        type: Number,
        required: true,
    },

    // amount of available storage on the node/drive
    free: {
        type: Number,
        required: true,
    },

    // amount of storage used by the system
    // computed from the data blocks owned by this node
    used: {
        type: Number,
        required: true,
    },

    // preallocated storage space
    alloc: {
        type: Number,
    },

    // top limit for used storage
    limit: {
        type: Number,
    }

};


/**
 *
 * NODE SCHEMA
 *
 * an edge node.
 *
 */
var node_schema = new Schema({

    name: {
        type: String,
        required: true,
    },

    pool: {
        // ref: 'Pool',
        type: types.ObjectId,
        required: true,
    },

    // system - pulled from the tier
    system: {
        // ref: 'System',
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

    srvmode: {
        type: String,
        enum: ['disabled', 'decommissioning', 'decommisioned']
    },

    // the identifier used for p2p signaling
    peer_id: {
        type: String,
    },

    // the public ip of the node
    ip: {
        type: String,
    },

    // the server address that the node is using
    base_address: {
        type: String,
    },

    // listening rpc address (url) of the agent
    rpc_address: {
        type: String,
    },

    // the last time the agent sent heartbeat
    heartbeat: {
        type: Date,
        required: true,
    },

    // the last agent version acknoledged
    version: {
        type: String,
    },

    // node storage stats - sum of drives
    storage: storage_stat_schema,

    drives: [{

        // mount point - linux, drive letter - windows
        mount: {
            type: String,
            required: true
        },

        // a fixed identifier (uuid / device-id / or something like that)
        drive_id: {
            type: String,
            required: true
        },

        // drive storage stats
        storage: storage_stat_schema
    }],

    // OS information sent by the agent
    os_info: {
        hostname: String,
        ostype: String,
        platform: String,
        arch: String,
        release: String,
        uptime: Date,
        loadavg: [Number],
        totalmem: Number,
        freemem: Number,
        cpus: [{}],
        networkInterfaces: {}
    },

    latency_to_server: [Number],
    latency_of_disk_read: [Number],
    latency_of_disk_write: [Number],

    debug_level: {
        type: Number,
    },

    // on delete set deletion time
    deleted: {
        type: Date,
    },

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});


node_schema.index({
    system: 1,
    pool: 1,
    name: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true
});

node_schema.index({
    peer_id: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true,
    sparse: true
});

module.exports = mongoose.model('Node', node_schema);
