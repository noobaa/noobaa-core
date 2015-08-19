/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;

/**
 *
 * CLUSTER SCHEMA
 *
 * Cluster Definitions and structure
 *
 */
var cluster_schema = new Schema({

    cluster_id: {
        type: String,
        required: true,
    },
}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

cluster_schema.index({
    cluster_id: 1,
}, {
    unique: true
});

module.exports = mongoose.model('Cluster', cluster_schema);
