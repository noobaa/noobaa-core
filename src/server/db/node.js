/* jshint node:true */
'use strict';

var _ = require('lodash');
var moment = require('moment');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var size_utils = require('../../util/size_utils');

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

    storage: {
        // the allocated storage space
        alloc: {
            type: Number,
            required: true,
        },

        // the used storage computed from the data blocks owned by this node
        used: {
            type: Number,
            required: true,
        },
    },

    srvmode: {
        type: String,
        enum: ['blocked', 'decommissioning', 'decommisioned']
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

    // device information sent by the agent.
    // TODO define schema for device_info
    device_info: {},

    // on delete set deletion time
    deleted: {
        type: Date,
    },

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

node_schema.index({
    ip: 1,
    port: 1,
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
            emit(['', 'alloc'], this.storage.alloc);
            emit(['', 'used'], this.storage.used);
            emit(['', 'count'], 1);
            var online = (!this.srvmode && this.heartbeat >= minimum_online_heartbeat);
            if (online) {
                emit(['', 'online'], 1);
            }
            emit([this.tier, 'alloc'], this.storage.alloc);
            emit([this.tier, 'used'], this.storage.used);
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

var Node = module.exports = mongoose.model('Node', node_schema);
