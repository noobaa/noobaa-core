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

    // the listening port of the agent running on the node
    port: {
        type: Number,
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
    tier: 1,
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

node_schema.methods.is_online = function() {
    return !this.srvmode && this.heartbeat >= get_minimum_online_heartbeat();
};

node_schema.statics.get_minimum_online_heartbeat = get_minimum_online_heartbeat;
node_schema.statics.get_minimum_alloc_heartbeat = get_minimum_alloc_heartbeat;

node_schema.methods.get_rpc_address = function() {
    var proto = process.env.AGENTS_PROTOCOL || 'n2n';
    if (proto === 'n2n') {
        return 'n2n://' + this.peer_id;
    } else {
        return proto + '://' + this.ip + ':' + this.port;
    }
};

/**
 *
 * aggregate_nodes
 *
 * counts the number of nodes and online nodes
 * and sum of storage (allocated, used) for the entire query, and per tier.
 *
 * @return <Object> tiers - the '' key represents the entire query and others are tier ids.
 *      each tier value is an object with properties: alloc, used, count, online.
 *
 */
node_schema.statics.aggregate_nodes = function(query) {
    var minimum_online_heartbeat = get_minimum_online_heartbeat();
    return this.mapReduce({
        query: query,
        scope: {
            // have to pass variables to map/reduce with a scope
            minimum_online_heartbeat: minimum_online_heartbeat,
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
            emit([this.tier, 'total'], this.storage.total);
            emit([this.tier, 'free'], this.storage.free);
            emit([this.tier, 'used'], this.storage.used);
            emit([this.tier, 'alloc'], this.storage.alloc);
            emit([this.tier, 'count'], 1);
            if (online) {
                emit([this.tier, 'online'], 1);
            }
        },
        reduce: size_utils.reduce_sum
    }).then(function(res) {
        var tiers = {};
        _.each(res, function(r) {
            var t = tiers[r._id[0]] = tiers[r._id[0]] || {};
            t[r._id[1]] = r.value;
        });
        return tiers;
    });
};

module.exports = mongoose.model('Node', node_schema);
