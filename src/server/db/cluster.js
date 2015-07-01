/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;

/**
 *
 * TIER SCHEMA
 *
 * storage tier - either edge or cloud.
 *
 */
var tier_schema = new Schema({

    cluster_id: {
        type: String,
        required: true,
    },
}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

tier_schema.index({
    cluster_id: 1,
}, {
    unique: true
});

module.exports = mongoose.model('Cluster', tier_schema);
