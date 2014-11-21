/* jshint node:true */
'use strict';

var _ = require('lodash');
var bcrypt = require('bcrypt');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

var system_schema = new Schema({

    name: {
        type: String,
        required: true,
    },

});

system_schema.index({
    name: 1,
}, {
    unique: true
});

var System = module.exports = mongoose.model('System', system_schema);
