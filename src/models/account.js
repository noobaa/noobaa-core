/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;
var _ = require('underscore');
var bcrypt = require('bcrypt');


var account_schema = new Schema({

    // account main contact email
    email: String,

    // the account secret password
    password: String,

});


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


var Account = mongoose.model('Account', account_schema);

module.exports = Account;
