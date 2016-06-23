/**
 *
 * TIER_SERVER
 *
 */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const RpcError = require('../../rpc/rpc_error');
const size_utils = require('../../util/size_utils');
const mongo_utils = require('../../util/mongo_utils');
const ActivityLog = require('../analytic_services/activity_log');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();


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
    var node_pool_ids = _.map(req.rpc_params.node_pools, function(pool_name) {
        return req.system.pools_by_name[pool_name]._id;
    });
    let cloud_pool_ids = _.map(req.rpc_params.cloud_pools, function(pool_name) {
        return req.system.pools_by_name[pool_name]._id;
    });
    let pool_ids = node_pool_ids.concat(cloud_pool_ids);
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
            var created_tier = find_tier_by_name(req);
            return get_tier_info(created_tier);
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
    return P.resolve()
        .then(() => nodes_client.instance().aggregate_nodes_by_pool(pool_ids))
        .then(nodes_aggregate_pool => get_tier_info(tier, nodes_aggregate_pool));
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
    if (req.rpc_params.node_pools) {
        updates.pools = _.map(req.rpc_params.node_pools, function(pool_name) {
            return req.system.pools_by_name[pool_name]._id;
        });
    }
    if (req.rpc_params.cloud_pools) {
        updates.pools = updates.pools.concat(_.map(req.rpc_params.cloud_pools, function(pool_name) {
            return req.system.pools_by_name[pool_name]._id;
        }));
    }
    updates._id = tier._id;
    return system_store.make_changes({
            update: {
                tiers: [updates]
            }
        })
        .then(res => {
            var bucket = find_bucket_by_tier(req);
            let desc_string = [];
            let policy_type_change = String(tier.data_placement) === String(req.rpc_params.data_placement) ? 'No changes' :
                `Changed to ${req.rpc_params.data_placement} from ${tier.data_placement}`;
            let tier_pools = _.map(tier.pools, pool => pool.name);
            let added_pools = [] || _.difference(req.rpc_params.node_pools.concat(req.rpc_params.cloud_pools), tier_pools);
            let removed_pools = [] || _.difference(tier_pools, req.rpc_params.node_pools.concat(req.rpc_params.cloud_pools));
            desc_string.push(`Bucket policy was changed by: ${req.account && req.account.email}`);
            desc_string.push(`Policy type: ${policy_type_change}`);
            if (added_pools.length) {
                desc_string.push(`Added pools: ${added_pools}`);
            }
            if (removed_pools.length) {
                desc_string.push(`Removed pools: ${removed_pools}`);
            }

            if (bucket) {
                ActivityLog.create({
                    event: 'bucket.edit_policy',
                    level: 'info',
                    system: req.system._id,
                    actor: req.account && req.account._id,
                    bucket: bucket._id,
                    desc: desc_string.join('\n'),
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
    throw new RpcError('TODO', 'TODO is update tiering policy needed?');
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
    return P.resolve()
        .then(() => nodes_client.instance().aggregate_nodes_by_pool(pool_ids))
        .then(nodes_aggregate_pool => get_tiering_policy_info(policy, nodes_aggregate_pool));
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
        //throw new RpcError('NOT_FOUND', 'POLICY OF TIER NOT FOUND ' + tier.name);
    }

    var bucket = _.find(system_store.data.buckets, function(o) {
        return (o.tiering._id.toString() === policy._id.toString());
    });

    if (!bucket) {
        return null;
        //throw new RpcError('NOT_FOUND', 'BUCKET OF TIER POLICY NOT FOUND ' + policy.name);
    }

    return bucket;
}

function find_tier_by_name(req) {
    var name = req.rpc_params.name;
    var tier = req.system.tiers_by_name[name];
    if (!tier) {
        throw new RpcError('NO_SUCH_TIER', 'No such tier: ' + name);
    }
    return tier;
}

function find_policy_by_name(req) {
    var name = req.rpc_params.name;
    var policy = req.system.tiering_policies_by_name[name];
    if (!policy) {
        throw new RpcError('NO_SUCH_TIERING_POLICY', 'No such tiering policy: ' + name);
    }
    return policy;
}

function get_tier_info(tier, nodes_aggregate_pool) {
    var info = _.pick(tier, 'name', TIER_PLACEMENT_FIELDS);
    let pools_partitions = _.partition(tier.pools, pool => _.isUndefined(pool.cloud_pool_info));
    let node_pools_part = pools_partitions[0];
    let cloud_pools_part = pools_partitions[1];
    info.node_pools = node_pools_part.map(pool => pool.name);
    info.cloud_pools = cloud_pools_part.map(pool => pool.name);
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


// EXPORTS
exports.new_tier_defaults = new_tier_defaults;
exports.new_policy_defaults = new_policy_defaults;
exports.get_tier_info = get_tier_info;
exports.get_tiering_policy_info = get_tiering_policy_info;
//Tiers
exports.create_tier = create_tier;
exports.read_tier = read_tier;
exports.update_tier = update_tier;
exports.delete_tier = delete_tier;
//Tiering Policy
exports.create_policy = create_policy;
exports.update_policy = update_policy;
exports.get_policy_pools = get_policy_pools;
exports.read_policy = read_policy;
exports.delete_policy = delete_policy;
