/* jshint node:true */
'use strict';

var _ = require('lodash');
var moment = require('moment');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var size_utils = require('../../util/size_utils');

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
        enum: ['disabled', 'decommissioning', 'decommisioned','storage_full']
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


function get_minimum_online_heartbeat() {
    return moment().subtract(5, 'minutes').toDate();
}

function get_minimum_alloc_heartbeat() {
    return moment().subtract(2, 'minutes').toDate();
}

node_schema.statics.is_online = function(node) {
    return !node.srvmode && node.heartbeat >= get_minimum_online_heartbeat();
};

node_schema.statics.get_minimum_online_heartbeat = get_minimum_online_heartbeat;
node_schema.statics.get_minimum_alloc_heartbeat = get_minimum_alloc_heartbeat;


/**
 *
 * aggregate_nodes
 * _by_tier - aggregatre by ttir
 * _by_pool - aggregate by pool
 *
 * counts the number of nodes and online nodes
 * and sum of storage (allocated, used) for the entire query, and per tier.
 *
 * @return <Object> tiers - the '' key represents the entire query and others are tier ids.
 *      each tier value is an object with properties: alloc, used, count, online.
 *
 */
node_schema.statics.aggregate_nodes = function(query, type) {
    var minimum_online_heartbeat = get_minimum_online_heartbeat();
    return this.mapReduce({
        query: query,
        scope: {
            // have to pass variables to map/reduce with a scope
            minimum_online_heartbeat: minimum_online_heartbeat,
            type: type,
        },
        map: function() {
            /* global emit */
            emit(['', 'total'], this.storage.total);
            emit(['', 'free'], this.storage.free);
            emit(['', 'used'], this.storage.used);
            emit(['', 'alloc'], this.storage.alloc);
            emit(['', 'count'], 1);
            var online = (!this.srvmode && this.heartbeat >= minimum_online_heartbeat);
            if (online) {
                emit(['', 'online'], 1);
            }
            emit([this[type], 'total'], this.storage.total);
            emit([this[type], 'free'], this.storage.free);
            emit([this[type], 'used'], this.storage.used);
            emit([this[type], 'alloc'], this.storage.alloc);
            emit([this[type], 'count'], 1);
            if (online) {
                emit([this[type], 'online'], 1);
            }
        },
        reduce: size_utils.reduce_sum
    }).then(function(res) {
        var bins = {};
        _.each(res, function(r) {
            var t = bins[r._id[0]] = bins[r._id[0]] || {};
            t[r._id[1]] = r.value;
        });
        return bins;
    });
};

module.exports = mongoose.model('Node', node_schema);
