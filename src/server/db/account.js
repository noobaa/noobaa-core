/* jshint node:true */
'use strict';

var _ = require('lodash');
var bcrypt = require('bcrypt');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 * Account represents a user with its credentials to authenticate.
 */
var account_schema = new Schema({

    name: {
        type: String,
        required: true,
    },

    email: {
        type: String,
        required: true,
    },

    // bcrypted password
    password: {
        type: String,
        required: true,
    },

    is_support: Boolean,

});

// primary-key: email
account_schema.index({
    email: 1,
}, {
    unique: true
});


// password verification - callback is function(err,is_matching)
account_schema.methods.verify_password = function(password, callback) {
    bcrypt.compare(password, this.password, callback);
};

// bcrypt middleware - replace passwords with hash before saving account
account_schema.pre('save', function(callback) {
    var account = this;
    if (!account.isModified('password')) {
        return callback();
    }
    bcrypt.genSalt(10, function(err, salt) {
        if (err) return callback(err);
        bcrypt.hash(account.password, salt, function(err, hash) {
            if (err) return callback(err);
            account.password = hash;
            return callback();
        });
    });
});


var Account = module.exports = mongoose.model('Account', account_schema);
