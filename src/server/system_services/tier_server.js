// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
// var P = require('../../util/promise');
var db = require('../db');
var dbg = require('../../util/debug_module')(__filename);
var size_utils = require('../../util/size_utils');
var mongo_utils = require('../../util/mongo_utils');
var nodes_store = require('../node_services/nodes_store');
var system_store = require('../system_services/system_store').get_instance();

/**
 *
 * TIER_SERVER
 *
 */
var tier_server = {
    new_tier_defaults: new_tier_defaults,
    new_policy_defaults: new_policy_defaults,
    get_tier_info: get_tier_info,
    get_tiering_policy_info: get_tiering_policy_info,

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
        _id: system_store.generate_id(),
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
        _id: system_store.generate_id(),
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
            req.load_auth();
            var create_tier = find_tier_by_name(req);
            return get_tier_info(create_tier);
        });
}



/**
 *
 * READ_TIER
 *
 */
function read_tier(req) {
    var tier = find_tier_by_name(req);
    var pool_ids = mongo_utils.uniq_ids(tier.pools, '_id');
    return nodes_store.aggregate_nodes_by_pool({
            system: req.system._id,
            pool: {
                $in: pool_ids
            },
            deleted: null,
        })
        .then(function(nodes_aggregate_pool) {
            return get_tier_info(tier, nodes_aggregate_pool);
        });
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
        })
        .then((res) => {
            var bucket = find_bucket_by_tier(req);
            if (bucket != null) {
                db.ActivityLog.create({
                    event: 'bucket.edit_policy',
                    level: 'info',
                    system: req.system._id,
                    actor: req.account && req.account._id,
                    bucket: bucket._id,
                });
            }
            return res;
        })
        .return();
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
            req.load_auth();
            var created_policy = find_policy_by_name(req);
            return get_tiering_policy_info(created_policy);
        });
}

function update_policy(req) {
    throw req.rpc_error('TODO', 'TODO is update tiering policy needed?');
}

function get_policy_pools(req) {
    var policy = find_policy_by_name(req);
    return get_tiering_policy_info(policy);
}

function read_policy(req) {
    var policy = find_policy_by_name(req);
    var pools = _.flatten(_.map(policy.tiers,
        tier_and_order => tier_and_order.tier.pools
    ));
    var pool_ids = mongo_utils.uniq_ids(pools, '_id');
    return nodes_store.aggregate_nodes_by_pool({
            system: req.system._id,
            pool: {
                $in: pool_ids
            },
            deleted: null,
        })
        .then(function(nodes_aggregate_pool) {
            return get_tiering_policy_info(policy, nodes_aggregate_pool);
        });
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

function find_bucket_by_tier(req) {
    var tier = find_tier_by_name(req);
    var policy = _.find(system_store.data.tieringpolicies, function(o) {
        return _.find(o.tiers, function(t) {
            return (t.tier._id.toString() === tier._id.toString());
        });
    });

    if (!policy) {
        return null;
        //throw req.rpc_error('NOT_FOUND', 'POLICY OF TIER NOT FOUND ' + tier.name);
    }

    var bucket = _.find(system_store.data.buckets, function(o) {
        return (o.tiering._id.toString() === policy._id.toString());
    });

    if (!bucket) {
        return null;
        //throw req.rpc_error('NOT_FOUND', 'BUCKET OF TIER POLICY NOT FOUND ' + policy.name);
    }

    return bucket;
}

function find_tier_by_name(req) {
    var name = req.rpc_params.name;
    var tier = req.system.tiers_by_name[name];
    if (!tier) {
        throw req.rpc_error('NO_SUCH_TIER', 'No such tier: ' + name);
    }
    return tier;
}

function find_policy_by_name(req) {
    var name = req.rpc_params.name;
    var policy = req.system.tiering_policies_by_name[name];
    if (!policy) {
        throw req.rpc_error('NO_SUCH_TIERING_POLICY', 'No such tiering policy: ' + name);
    }
    return policy;
}

function get_tier_info(tier, nodes_aggregate_pool) {
    var info = _.pick(tier, 'name', TIER_PLACEMENT_FIELDS);
    info.pools = _.map(tier.pools, pool => pool.name);
    var reducer;
    if (tier.data_placement === 'MIRROR') {
        reducer = size_utils.reduce_minimum;
    } else if (tier.data_placement === 'SPREAD') {
        reducer = size_utils.reduce_sum;
    } else {
        dbg.error('BAD TIER DATA PLACEMENT (assuming spread)', tier);
        reducer = size_utils.reduce_sum;
    }
    nodes_aggregate_pool = nodes_aggregate_pool || {};
    var pools_storage = _.map(tier.pools, pool => nodes_aggregate_pool[pool._id]);
    info.storage = size_utils.reduce_storage(reducer, pools_storage, 1, tier.replicas);
    _.defaults(info.storage, {
        used: 0,
        total: 0,
        free: 0,
    });
    return info;
}

function get_tiering_policy_info(tiering_policy, nodes_aggregate_pool) {
    var info = _.pick(tiering_policy, 'name');
    var tiers_storage = nodes_aggregate_pool ? [] : null;
    info.tiers = _.map(tiering_policy.tiers, function(tier_and_order) {
        if (tiers_storage) {
            var tier_info = get_tier_info(tier_and_order.tier, nodes_aggregate_pool);
            tiers_storage.push(tier_info.storage);
        }
        return {
            order: tier_and_order.order,
            tier: tier_and_order.tier.name
        };
    });
    if (tiers_storage) {
        info.storage = size_utils.reduce_storage(size_utils.reduce_sum, tiers_storage, 1, 1);
    }
    return info;
}
