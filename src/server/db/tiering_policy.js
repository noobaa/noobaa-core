/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


/**
 *
 * TIERING POLICY SCHEMA
 *
 */
var tiering_policy_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    name: {
        type: String,
        required: true,
    },

    tiers: [{
        order: {
            type: Number,
            required: true,
        },
        tier: {
            ref: 'Tier',
            type: types.ObjectId,
            required: true,
        },
    }],
}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

tiering_policy_schema.index({
    system: 1,
    name: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true
});

module.exports = mongoose.model('TieringPolicy', tiering_policy_schema);
