// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');


/**
 *
 * TIER_SERVER
 *
 */
var tier_server = {
    //Tiers
    create_tier: create_tier,
    read_tier: read_tier,
    update_tier: update_tier,
    delete_tier: delete_tier,
    list_tiers: list_tiers,

    //Tiering Policy
    create_policy: create_policy,
    update_policy: update_policy,
    get_policy: get_policy,
    delete_policy: delete_policy
};

module.exports = tier_server;




/**
 *
 * CREATE_TIER
 *
 */
function create_tier(req) {
    var info = _.pick(req.rpc_params, 'name', 'kind', 'edge_details', 'cloud_details', 'pools', 'nodes', 'data_placement');
    info.system = req.system.id;
    return P.when(db.Tier.create(info))
        .then(null, db.check_already_exists(req, 'tier'))
        .thenResolve();
}



/**
 *
 * READ_TIER
 *
 */
function read_tier(req) {
    return P.when(db.Tier
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
    var updates = _.pick(req.rpc_params, 'edge_details', 'cloud_details');
    if (req.rpc_params.new_name) {
        updates.name = req.rpc_params.new_name;
    }
    return P.when(db.Tier
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
    return P.when(db.Tier
            .findOneAndUpdate(get_tier_query(req), updates)
            .exec())
        .then(db.check_not_found(req, 'tier'))
        .thenResolve();
}


/**
 *
 * LIST_TIERS
 *
 */
function list_tiers(req) {
    var query = {
        system: req.system.id,
        delete: null,
    };

    return P.when(
            db.Tier.find(query).exec())
        .then(function(tiers) {
            return tiers;
        });
}

// TIERING POLICY /////////////////////////////////////////////////
function create_policy(req) {
    var info = _.pick(req.rpc_params.policy, 'name', 'tiers');
    var tiers = _.pluck(req.rpc_params.policy.tiers, 'tier');
    return P.when(
            db.Tier.find({
                system: req.system.id,
                name: {
                    $in: tiers
                },
                deleted: null,
            })
            .exec())
        .then(function(tiers) {
            if (tiers.length !== info.tiers.length) {
                throw new Error('DB Tiers and requested tiers are not equal');
            }
            info.system = req.system.id;
            _.each(tiers, function(t) {
                var ind = _.findIndex(info.tiers, function(it) {
                    return it.tier === t.name;
                });
                info.tiers[ind].tier = t._id;
            });
            return P.when(db.TieringPolicy.create(info))
                .then(null, db.check_already_exists(req, 'tiering_policy'))
                .thenResolve();
        });
}

function update_policy(req) {

}

function get_policy(req) {

}

function delete_policy(req) {

}


// UTILS //////////////////////////////////////////////////////////


function get_tier_query(req) {
    return {
        system: req.system.id,
        name: req.rpc_params.name,
        deleted: null,
    };
}
