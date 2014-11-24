/* jshint node:true */
'use strict';

var _ = require('lodash');
var bcrypt = require('bcrypt');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 * System defines an infrastructure entity.
 * Allows to create several separated systems on the same domain.
 */
var system_schema = new Schema({

    name: {
        type: String,
        required: true,
    },

    deleted: {
        type: Date,
    },

});

system_schema.index({
    name: 1,
    deleted: 1,
}, {
    unique: true
});

var System = module.exports = mongoose.model('System', system_schema);
