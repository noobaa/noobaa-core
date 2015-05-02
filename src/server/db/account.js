/* jshint node:true */
'use strict';

var bcrypt = require('bcrypt');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

/**
 *
 * ACCOUNT SCHEMA
 *
 * represents a user with its credentials to authenticate.
 *
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

    // account mark for support ppl
    is_support: {
        type: Boolean,
    },

    // on delete set deletion time
    deleted: {
        type: Date
    }

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

account_schema.index({
    email: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true
});


/**
 *
 * verify_password()
 *
 * password verification - callback is function(err,is_matching)
 *
 */
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


module.exports = mongoose.model('Account', account_schema);
