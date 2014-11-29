/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;


/**
 *
 * BUCKET SCHEMA
 *
 */
var bucket_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    name: {
        type: String,
        required: true,
    },

    // optional subdomain name - must be unique in the domain
    // in order to resolve REST urls such as:
    //   https://www.noobaa.com/{{subdomain}}/{{objectkey}}
    // or as real subdomain
    //   https://{{subdomain}}.noobaa.com/{{objectkey}}
    subdomain: {
        type: String,
    },

    // the bucket's tiering policy - list of tiers to use
    tiering: [{
        tier: {
            ref: 'Tier',
            type: types.ObjectId,
            required: true,
        },
    }],

    // on delete set deletion time
    deleted: {
        type: Date,
    },

});


bucket_schema.index({
    system: 1,
    name: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true
});


bucket_schema.index({
    subdomain: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true,
    // subdomain is not required so we have to define the index as sparse
    // for the null values to not collide.
    sparse: true,
});

var Bucket = module.exports = mongoose.model('Bucket', bucket_schema);
