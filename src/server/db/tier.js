/* jshint node:true */
'use strict';

var _ = require('lodash');
var bcrypt = require('bcrypt');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 *
 * TIER SCHEMA
 *
 * storage tier - either edge or cloud.
 *
 */
var tier_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    name: {
        type: String,
        required: true,
    },

    kind: {
        enum: ['edge', 'cloud'],
        type: String,
        required: true,
    },

    edge_details: {
        replicas: {
            type: Number,
        },
        // see kfrag in data_chunk.js
        data_fragments: {
            type: Number,
        },
        parity_fragments: {
            type: Number,
        },
    },

    // details needed to access the cloud storage
    // for example for AWS S3 the details should contain:
    //     access_key, secret, region, etc.
    // TODO define schema for cloud_details?
    cloud_details: {},

    // on delete set deletion time
    deleted: {
        type: Date,
    },

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

tier_schema.index({
    system: 1,
    name: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true
});

var Tier = module.exports = mongoose.model('Tier', tier_schema);
