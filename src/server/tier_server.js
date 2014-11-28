// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var api = require('../api');
var db = require('./db');


var tier_server = new api.tier_api.Server({

    // CRUD
    create_tier: create_tier,
    read_tier: read_tier,
    update_tier: update_tier,
    delete_tier: delete_tier,
}, {
    before: function(req) {
        return req.load_system(['admin']);
    }
});

module.exports = tier_server;



//////////
// CRUD //
//////////

function create_tier(req) {
    return Q.fcall(function() {
            var info = _.pick(req.rest_params, 'name', 'kind');
            info.system = req.system.id;
            return db.Tier.create(info);
        })
        .then(null, db.check_already_exists(req, 'tier'))
        .thenResolve();

}

function read_tier(req) {
    // TODO
}

function update_tier(req) {
    // TODO
}

function delete_tier(req) {
    return Q.when(db.Tier.findOneAndUpdate({
            system: req.system.id,
            name: req.rest_params.name,
        }, {
            deleted: new Date()
        }).exec())
        .then(db.check_not_found(req, 'tier'))
        .thenResolve();
}
