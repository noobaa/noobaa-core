// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var dbg = require('../util/debug_module')(__filename);
var system_store = require('./stores/system_store');
var size_utils = require('../util/size_utils');
var mongo_utils = require('../util/mongo_utils');
var db = require('./db');

/**
 *
 * TIER_SERVER
 *
 */
var tier_server = {
    new_tier_defaults: new_tier_defaults,
    get_tier_info: get_tier_info,
    create_tier: create_tier,
    read_tier: read_tier,
    update_tier: update_tier,
    delete_tier: delete_tier,
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

const TIER_PLACEMENT_FIELDS = [
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
            return get_tier_info(tier);
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
    return P.when(db.Node.aggregate_nodes({
            system: req.system._id,
            pool: {
                $in: pool_ids
            },
            deleted: null,
        }, 'pool'))
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


// UTILS //////////////////////////////////////////////////////////


function find_tier_by_name(req) {
    var name = req.rpc_params.name;
    var tier = req.system.tiers_by_name[name];
    if (!tier) {
        throw req.rpc_error('NOT_FOUND', 'TIER NOT FOUND ' + name);
    }
    return tier;
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
