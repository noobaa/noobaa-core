// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');
var dbg = require('../util/debug_module')(__filename);

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
    get_policy_pools: get_policy_pools,
    read_policy: read_policy,
    delete_policy: delete_policy
};

module.exports = tier_server;




/**
 *
 * CREATE_TIER
 *
 */
function create_tier(req) {
    var info = _.pick(req.rpc_params, 'name', 'cloud_details', 'nodes', 'data_placement');
    if (req.rpc_params.edge_details) {
        if (req.rpc_params.edge_details.replicas) {
            info.replicas = req.rpc_params.edge_details.replicas;
        }
        if (req.rpc_params.edge_details.data_fragments) {
            info.data_fragments = req.rpc_params.edge_details.data_fragments;
        }
        if (req.rpc_params.edge_details.parity_fragments) {
            info.parity_fragments = req.rpc_params.edge_details.parity_fragments;
        }
    }
    info.system = req.system.id;
    return P.when(db.Pool.find({
                name: {
                    $in: req.rpc_params.pools,
                },
            })
            .exec())
        .then(function(pools) {
            var ids = [];
            _.each(pools, function(p) {
                ids.push(p._id);
            });
            info.pools = ids;
            dbg.log0('Creating new tier', info);
            return P.when(db.Tier.create(info))
                .then(null, db.check_already_exists(req, 'tier'))
                .then(function() {
                    return P.when(read_tier(req));
                });
        });
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
            var reply = _.pick(tier, 'name');
            reply.edge_details = {
                replicas: tier.replicas,
                data_fragments: tier.data_fragments,
                parity_fragments: tier.parity_fragments,
            };
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
    var updates = _.pick(req.rpc_params, 'cloud_details');
    if (req.rpc_params.new_name) {
        updates.name = req.rpc_params.new_name;
    }
    if (req.rpc_params.edge_details.replicas) {
        updates.replicas = req.rpc_params.edge_details.replicas;
    }
    if (req.rpc_params.edge_details.data_fragments) {
        updates.data_fragments = req.rpc_params.edge_details.data_fragments;
    }
    if (req.rpc_params.edge_details.parity_fragments) {
        updates.parity_fragments = req.rpc_params.edge_details.parity_fragments;
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
    dbg.log0('Deleting tier', req.rpc_params.name, 'on', req.system.id);
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
    dbg.log0('Creating tiering policy', info);
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
                .then(function() {
                    req.rpc_params.name = req.rpc_params.policy.name;
                    return P.when(get_policy_pools(req));
                });
        });
}

function update_policy(req) {
    dbg.log0('Updating tiering policy');
}

function get_policy_pools(req) {
    return P.when(db.TieringPolicy
            .findOne(get_policy_query(req))
            .exec())
        .then(db.check_not_deleted(req, 'tiering_policy'))
        .then(function(policy) {
            var reply = {};
            reply.name = policy.name;
            reply.tiers = policy.tiers;
            return reply;
        });
}

function read_policy(req) {
    var reply = {};
    return P.when(db.TieringPolicy
            .findOne(get_policy_query(req))
            .populate('tiers')
            .exec())
        .then(db.check_not_deleted(req, 'tiering_policy'))
        .then(function(policy) {
            reply.name = policy.name;
            return P.all(_.map(policy.tiers, function(t) {
                    return P.when(db.Tier
                            .findOne({
                                _id: t.tier,
                                deleted: null,
                            })
                            .exec())
                        .then(function(tier) {
                            return P.when(db.Pool
                                    .find({
                                        _id: {
                                            $in: tier.pools
                                        }
                                    }))
                                .then(function(pools) {
                                    return {
                                        order: t.order,
                                        tier: {
                                            name: tier.name,
                                            data_placement: tier.data_placement,
                                            pools: _.map(pools, function(p) {
                                                return p.name;
                                            })
                                        },
                                    };
                                });
                        });
                }))
                .then(function(tiers) {
                    reply.tiers = tiers;
                    return reply;
                });
        });
}

function delete_policy(req) {
    dbg.log0('Deleting tiering policy', req.rpc_params.name);
    return P.when(db.TieringPolicy
            .findOne(get_policy_query(req))
            .exec())
        .then(db.check_not_deleted(req, 'tier'))
        .then(function(policy) {
            var updates = {
                deleted: new Date()
            };
            return P.when(db.TieringPolicy
                .findOneAndUpdate(get_policy_query(req), updates)
                .exec());
        });
}


// UTILS //////////////////////////////////////////////////////////


function get_tier_query(req) {
    return {
        system: req.system.id,
        name: req.rpc_params.name,
        deleted: null,
    };
}

function get_policy_query(req) {
    return {
        system: req.system.id,
        name: req.rpc_params.name,
        deleted: null,
    };
}
