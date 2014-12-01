// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var moment = require('moment');
var size_utils = require('../util/size_utils');
var api = require('../api');
var db = require('./db');


/**
 *
 * TIER SERVER (REST)
 *
 */
module.exports = new api.tier_api.Server({
    create_tier: create_tier,
    read_tier: read_tier,
    update_tier: update_tier,
    delete_tier: delete_tier,
});



/**
 *
 * CREATE_TIER
 *
 */
function create_tier(req) {
    var info = _.pick(req.rest_params, 'name', 'kind', 'edge_details', 'cloud_details');
    info.system = req.system.id;
    return Q.when(db.Tier.create(info))
        .then(null, db.check_already_exists(req, 'tier'))
        .thenResolve();
}



/**
 *
 * READ_TIER
 *
 */
function read_tier(req) {
    return Q.when(db.Tier
            .findOne(get_tier_query(req))
            .exec())
        .then(db.check_not_deleted(req, 'tier'))
        .then(function(tier) {
            var reply = _.pick(tier, 'name', 'kind');
            if (tier.kind === 'edge') {
                reply.edge_details = tier.edge_details.toObject();
            } else if (tier.kind === 'cloud') {
                reply.cloud_details = tier.cloud_details;
            }
            // TODO read tier's storage and nodes
            reply.storage = {
                alloc: 0,
                used: 0,
            };
            reply.nodes = {
                count: 0,
                online: 0,
            };
            return reply;
        });
}



/**
 *
 * UPDATE_TIER
 *
 */
function update_tier(req) {
    var updates = _.pick(req.rest_params, 'edge_details', 'cloud_details');
    if (req.rest_params.new_name) {
        updates.name = req.rest_params.new_name;
    }
    return Q.when(db.Tier
            .findOneAndUpdate(get_tier_query(req), updates)
            .exec())
        .then(db.check_not_deleted(req, 'tier'))
        .thenResolve();
}



/**
 *
 * DELETE_TIER
 *
 */
function delete_tier(req) {
    var updates = {
        deleted: new Date()
    };
    return Q.when(db.Tier
            .findOneAndUpdate(get_tier_query(req), updates)
            .exec())
        .then(db.check_not_found(req, 'tier'))
        .thenResolve();
}




// UTILS //////////////////////////////////////////////////////////


function get_tier_query(req) {
    return {
        system: req.system.id,
        name: req.rest_params.name,
        deleted: null,
    };
}
