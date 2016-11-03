/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 *
 * ALERTS_LOG SCHEMA
 *
 */
var alerts_log_schema = new Schema({
    _id: {
        format: 'objectid'
    },

    system: {
        ref: 'System',
        type: types.ObjectId,
    },

    time: {
        type: Date,
        default: Date.now,
        required: true,
    },

    severity: {
        type: String,
        enum: ['CRIT', 'NAJOR', 'INFO'],
        required: true,
    },

    alert: {
        type: String,
        required: true,
    },

    read: {
        type: Boolean,
        default: false,
        require: true,
    }
}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

alerts_log_schema.index({
    system: 1,
    time: 1,
    level: 1,
    event: 1,
}, {
    unique: false
});


module.exports = mongoose.model('AlertsLog', alerts_log_schema);
