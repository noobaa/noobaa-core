/* jshint node:true */
'use strict';

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

    // the bucket's tiering policy - ordered list of tiers to use
    tiering: [{
        tier: {
            ref: 'Tier',
            type: types.ObjectId,
            required: true,
        },
    }],

    // cloud sync target, if exists
    cloud_sync: {
        // Target endpoint, location + bucket
        endpoint: {
            type: String
        },

        access_keys: {
            access_key: {
                type: String,
            },
            secret_key: {
                type: String,
            }
        },

        // Changed query interval
        schedule: {
            type: Number
        },

        // Paused cloud sync
        paused: {
            type: Boolean,
        },

        // Last finished sync
        last_sync: {
            type: Date
        },
    },

    // on delete set deletion time
    deleted: {
        type: Date,
    },

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
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

module.exports = mongoose.model('Bucket', bucket_schema);
