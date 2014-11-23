/* jshint node:true */
'use strict';

var _ = require('lodash');
var bcrypt = require('bcrypt');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 * A permission for account to act on a system.
 */
var system_permission_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    account: {
        ref: 'Account',
        type: types.ObjectId,
        required: true,
    },

    // permission flags
    is_admin: Boolean,
    is_agent: Boolean,

});

system_permission_schema.index({
    system: 1,
    account: 1,
}, {
    unique: true
});

var SystemPermission = module.exports = mongoose.model('SystemPermission', system_permission_schema);
