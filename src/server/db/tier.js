/* jshint node:true */
'use strict';

var _ = require('lodash');
var bcrypt = require('bcrypt');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 * storage tier DB model
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

    // details needed to access the cloud storage
    cloud_details: {
        type: Object,
    },

    // on delete set deletion time
    deleted: {
        type: Date,
    },

});

tier_schema.index({
    system: 1,
    name: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true
});

var Tier = module.exports = mongoose.model('Tier', tier_schema);
