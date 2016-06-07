/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 *
 * ACTIVITY_LOG SCHEMA
 *
 * log items collected and made available in admin console
 *
 */
var activity_log_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    time: {
        type: Date,
        default: Date.now,
        required: true,
    },

    level: {
        type: String,
        enum: ['info', 'warning', 'alert'],
        required: true,
    },

    event: {
        type: String,
        required: true,
    },

    desc: {
        type: String,
    },

    tier: {
        // ref: 'Tier',
        type: types.ObjectId,
    },
    node: {
        // ref: 'Node',
        type: types.ObjectId,
    },
    bucket: {
        // ref: 'Bucket',
        type: types.ObjectId,
    },
    obj: {
        ref: 'ObjectMD',
        type: types.ObjectId,
    },
    account: {
        // ref: 'Account',
        type: types.ObjectId,
    },
    pool: {
        //ref: 'Pool',
        type: types.ObjectId,
    },
    //The User that performed the action
    actor: {
        // ref: 'Account',
        type: types.ObjectId
    }
}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

activity_log_schema.index({
    system: 1,
    time: 1,
    level: 1,
    event: 1,
}, {
    unique: false
});


module.exports = mongoose.model('ActivityLog', activity_log_schema);
