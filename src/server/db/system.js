/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 *
 * SYSTEM SCHEMA
 *
 * System defines an infrastructure entity.
 * Allows to create several separated systems on the same domain.
 *
 */
var system_schema = new Schema({

    name: {
        type: String,
        required: true,
    },

    owner: {
        ref: 'Account',
        type: types.ObjectId,
        required: true,
    },

    access_keys: [{
        access_key: {
            type: String,
            required: true,
        },
        secret_key: {
            type: String,
            required: true,
        }
    }],


    // on delete set deletion time
    deleted: {
        type: Date,
    },

    // links to system resources used for storing install packages
    resources: {
        agent_installer: {
            type: String
        },
        linux_agent_installer: {
            type: String
        },
        s3rest_installer: {
            type: String
        },
    },

    // n2n_config
    // keeps the n2n configuration for agents and other endpoints (see rpc_n2n.js)
    // we use free mongoose schema, because it's field types are non trivial
    // (see n2n_config json schema in common_api.js) and there's no benefit
    // redefining it for mongoose.
    n2n_config: {},

    // the DNS name or IP address used for the server
    base_address: {
        type: String
    },

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

system_schema.index({
    name: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true
});

module.exports = mongoose.model('System', system_schema);
