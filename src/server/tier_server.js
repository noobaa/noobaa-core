// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
// var P = require('../util/promise');
var db = require('./db');
var dbg = require('../util/debug_module')(__filename);
var system_store = require('./stores/system_store');

/**
 *
 * TIER_SERVER
 *
 */
var tier_server = {
    new_tier_defaults: new_tier_defaults,
    new_policy_defaults: new_policy_defaults,

    //Tiers
    create_tier: create_tier,
    read_tier: read_tier,
    update_tier: update_tier,
    delete_tier: delete_tier,

    //Tiering Policy
    create_policy: create_policy,
    update_policy: update_policy,
    get_policy_pools: get_policy_pools,
    read_policy: read_policy,
    delete_policy: delete_policy
};

module.exports = tier_server;



function new_tier_defaults(name, system_id, pool_ids) {
    return {
        _id: db.new_object_id(),
        system: system_id,
        name: name,
        replicas: 3,
        data_fragments: 1,
        parity_fragments: 0,
        data_placement: 'SPREAD',
        pools: pool_ids,
    };
}

function new_policy_defaults(name, system_id, tiers_orders) {
    return {
        _id: db.new_object_id(),
        system: system_id,
        name: name,
        tiers: tiers_orders
    };
}

var TIER_PLACEMENT_FIELDS = [
    'data_placement',
    'replicas',
    'data_fragments',
    'parity_fragments'
];

/**
 *
 * CREATE_TIER
 *
 */
function create_tier(req) {
    var pool_ids = _.map(req.rpc_params.pools, function(pool_name) {
        return req.system.pools_by_name[pool_name]._id;
    });
    var tier = new_tier_defaults(req.rpc_params.name, req.system._id, pool_ids);
    _.merge(tier, _.pick(req.rpc_params, TIER_PLACEMENT_FIELDS));
    dbg.log0('Creating new tier', tier);
    return system_store.make_changes({
            insert: {
                tiers: [tier]
            }
        })
        .then(function() {
            return read_tier(req);
        });
}



/**
 *
 * READ_TIER
 *
 */
function read_tier(req) {
    var tier = find_tier_by_name(req);
    var reply = _.pick(tier, TIER_PLACEMENT_FIELDS.concat(['name']));
    reply.pools = _.map(tier.pools, function(pool) {
        return pool.name;
    });
    // TODO read tier's storage
    reply.storage = {
        alloc: 0,
        used: 0,
    };
    return reply;
}



/**
 *
 * UPDATE_TIER
 *
 */
function update_tier(req) {
    var tier = find_tier_by_name(req);
    var updates = _.pick(req.rpc_params, TIER_PLACEMENT_FIELDS);
    if (req.rpc_params.new_name) {
        updates.name = req.rpc_params.new_name;
    }
    if (req.rpc_params.pools) {
        updates.pools = _.map(req.rpc_params.pools, function(pool_name) {
            return req.system.pools_by_name[pool_name]._id;
        });
    }
    updates._id = tier._id;
    return system_store.make_changes({
        update: {
            tiers: [updates]
        }
    }).return();
}



/**
 *
 * DELETE_TIER
 *
 */
function delete_tier(req) {
    dbg.log0('Deleting tier', req.rpc_params.name, 'on', req.system._id);
    var tier = find_tier_by_name(req);
    return system_store.make_changes({
        remove: {
            tiers: [tier._id]
        }
    }).return();
}




// TIERING POLICY /////////////////////////////////////////////////

function create_policy(req) {
    var policy = new_policy_defaults(
        req.rpc_params.name,
        req.system._id,
        _.map(req.rpc_params.tiers, function(t) {
            return {
                order: t.order,
                tier: req.system.tiers_by_name[t.tier]._id,
            };
        }));
    dbg.log0('Creating tiering policy', policy);
    return system_store.make_changes({
            insert: {
                tieringpolicies: [policy]
            }
        })
        .then(function() {
            return read_policy(req);
        });
}

function update_policy(req) {
    dbg.log0('Updating tiering policy');
}

function get_policy_pools(req) {
    var policy = find_policy_by_name(req);
    var reply = _.pick(policy, 'name', 'tiers');
    return reply;
}

function read_policy(req) {
    var policy = find_policy_by_name(req);
    var reply = _.pick(policy, 'name');
    reply.tiers = _.map(policy.tiers, function(t) {
        return {
            order: t.order,
            tier: {
                name: t.tier.name,
                data_placement: t.tier.data_placement,
                pools: _.map(t.tier.pools, function(p) {
                    return p.name;
                })
            },
        };
    });
    return reply;
}

function delete_policy(req) {
    dbg.log0('Deleting tiering policy', req.rpc_params.name);
    var policy = find_policy_by_name(req);
    return system_store.make_changes({
        remove: {
            tieringpolicies: [policy._id]
        }
    });
}


// UTILS //////////////////////////////////////////////////////////


function find_tier_by_name(req) {
    var name = req.rpc_params.name;
    var tier = req.system.tiers_by_name[name];
    if (!tier) {
        throw req.rpc_error('NOT_FOUND', 'TIER NOT FOUND ' + name);
    }
    return tier;
}

function find_policy_by_name(req) {
    var name = req.rpc_params.name;
    var policy = req.system.tiering_policies_by_name[name];
    if (!policy) {
        throw req.rpc_error('NOT_FOUND', 'POLICY NOT FOUND ' + name);
    }
    return policy;
}
