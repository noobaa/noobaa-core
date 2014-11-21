/* jshint node:true */
'use strict';

var _ = require('lodash');
var bcrypt = require('bcrypt');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

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

});

tier_schema.index({
    system: 1,
    name: 1,
}, {
    unique: true
});

var Tier = module.exports = mongoose.model('Tier', tier_schema);
