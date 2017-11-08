/* Copyright (C) 2016 NooBaa */
/**
 *
 * TIER_SERVER
 *
 */
'use strict';

const _ = require('lodash');
const config = require('../../../config');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const { RpcError } = require('../../rpc');
const size_utils = require('../../util/size_utils');
const Dispatcher = require('../notifications/dispatcher');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();


function new_tier_defaults(name, system_id, chunk_config, mirrors) {
    return {
        _id: system_store.generate_id(),
        name: name,
        system: system_id,
        chunk_config,
        data_placement: 'SPREAD',
        mirrors,
    };
}

function new_policy_defaults(name, system_id, tiers_orders) {
    return {
        _id: system_store.generate_id(),
        name: name,
        system: system_id,
        tiers: tiers_orders,
        chunk_split_config: {
            avg_chunk: config.CHUNK_SPLIT_AVG_CHUNK,
            delta_chunk: config.CHUNK_SPLIT_DELTA_CHUNK,
        },
    };
}

function new_chunk_code_config_defaults(chunk_coder_config) {
    const ccc = Object.assign({
        digest_type: config.CHUNK_CODER_DIGEST_TYPE,
        frag_digest_type: config.CHUNK_CODER_FRAG_DIGEST_TYPE,
        compress_type: config.CHUNK_CODER_COMPRESS_TYPE,
        cipher_type: config.CHUNK_CODER_CIPHER_TYPE,
    }, chunk_coder_config);

    if (ccc.parity_frags) {
        // Erasure Codes
        ccc.replicas = ccc.replicas || 1;
        ccc.data_frags = ccc.data_frags || 1;
        ccc.parity_type = ccc.parity_type || config.CHUNK_CODER_EC_PARITY_TYPE;
    } else {
        // Data Copies
        ccc.replicas = ccc.replicas || 3;
        ccc.data_frags = ccc.data_frags || 1;
        ccc.parity_frags = 0;
        delete ccc.parity_type;
    }

    return ccc;
}

/**
 *
 * CREATE_TIER
 *
 */
function create_tier(req) {
    const policy_pool_ids = _.map(req.rpc_params.attached_pools, function(pool_name) {
        return req.system.pools_by_name[pool_name]._id;
    });

    const chunk_coder_config = new_chunk_code_config_defaults(
        req.rpc_params.chunk_coder_config || req.account.default_chunk_config || req.system.default_chunk_config);
    const existing_chunk_config = _.find(req.system.chunk_configs_by_id,
        c => _.matches(c.chunk_coder_config, chunk_coder_config));
    const chunk_config = existing_chunk_config || {
        _id: system_store.generate_id(),
        system: req.system._id,
        chunk_coder_config,
    };
    const insert_chunk_configs = chunk_config === existing_chunk_config ? undefined : [chunk_config];

    const mirrors = _convert_pools_to_data_placement_structure(policy_pool_ids, req.rpc_params.data_placement);

    const tier = new_tier_defaults(
        req.rpc_params.name,
        req.system._id,
        chunk_config._id,
        mirrors
    );
    if (req.rpc_params.data_placement) tier.data_placement = req.rpc_params.data_placement;

    dbg.log0('Creating new tier', tier);
    return system_store.make_changes({
            insert: {
                tiers: [tier],
                chunk_configs: insert_chunk_configs,
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
    var pool_names = [];

    _.each(tier.mirrors, object => {
        _.each(object.spread_pools, pool => {
            pool_names.push((pool && pool.name) || '');
        });
    });

    return P.join(
            nodes_client.instance().aggregate_nodes_by_pool(_.compact(pool_names), req.system._id),
            nodes_client.instance().aggregate_data_free_by_tier([String(tier._id)], req.system._id)
        )
        .spread(function(nodes_aggregate_pool, available_to_upload) {
            return get_tier_info(tier, nodes_aggregate_pool, available_to_upload[String(tier._id)]);
        });
}


function _convert_pools_to_data_placement_structure(pool_ids, data_placement) {
    let mirrors = [];
    if (data_placement === 'MIRROR') {
        _.forEach(pool_ids, pool_id => mirrors.push({
            spread_pools: [pool_id]
        }));
    } else {
        mirrors.push({
            spread_pools: pool_ids
        });
    }
    return mirrors;
}


/**
 *
 * UPDATE_TIER
 *
 */
function update_tier(req) {
    var tier = find_tier_by_name(req);
    var updates = {};
    if (req.rpc_params.new_name) {
        updates.name = req.rpc_params.new_name;
    }
    if (req.rpc_params.data_placement) {
        updates.data_placement = req.rpc_params.data_placement;
    }

    const chunk_coder_config = new_chunk_code_config_defaults(
        req.rpc_params.chunk_coder_config || req.account.default_chunk_config || req.system.default_chunk_config);
    const existing_chunk_config = _.find(req.system.chunk_configs_by_id,
        c => _.matches(c.chunk_coder_config, chunk_coder_config));
    const chunk_config = existing_chunk_config || {
        _id: system_store.generate_id(),
        system: req.system._id,
        chunk_coder_config,
    };
    const insert_chunk_configs = chunk_config === existing_chunk_config ? undefined : [chunk_config];
    if (chunk_config !== tier.chunk_config) {
        updates.chunk_config = chunk_config._id;
    }

    let old_pool_names = [];
    // if node_pools are defined use it for the update otherwise use the existing
    if (req.rpc_params.attached_pools) {
        updates.mirrors = _convert_pools_to_data_placement_structure(
            _.map(req.rpc_params.attached_pools, pool_name => req.system.pools_by_name[pool_name]._id),
            req.rpc_params.data_placement || tier.data_placement);

        _.forEach(tier.mirrors, mirror_object => {
            old_pool_names = _.concat(old_pool_names, _.map((mirror_object && mirror_object.spread_pools) || [], pool => pool.name));
        });
        old_pool_names = _.compact(old_pool_names);
    } else if (tier.data_placement !== req.rpc_params.data_placement) {
        let pool_ids = [];
        _.forEach(tier.mirrors, mirror_object => {
            pool_ids = _.concat(pool_ids, _.map((mirror_object && mirror_object.spread_pools) || [], pool => pool._id));
        });
        pool_ids = _.compact(pool_ids);

        updates.mirrors = _convert_pools_to_data_placement_structure(pool_ids, req.rpc_params.data_placement);
    }

    updates._id = tier._id;
    return system_store.make_changes({
            update: {
                tiers: [updates]
            },
            insert: {
                chunk_configs: insert_chunk_configs,
            },
        })
        .then(res => {
            var bucket = find_bucket_by_tier(req);
            let desc_string = [];
            if (req.rpc_params.data_placement) { //Placement policy changes
                let policy_type_change = String(tier.data_placement) === String(req.rpc_params.data_placement) ? 'No changes' :
                    `Changed to ${req.rpc_params.data_placement} from ${tier.data_placement}`;
                let removed_pools = _.difference(old_pool_names, req.rpc_params.attached_pools || []);
                let added_pools = _.difference(req.rpc_params.attached_pools || [], old_pool_names);
                desc_string.push(`Bucket policy was changed by: ${req.account && req.account.email}`);
                desc_string.push(`Policy type: ${policy_type_change}`);
                if (removed_pools.length) {
                    desc_string.push(`Removed resources: ${removed_pools.join(', ')}`);
                }
                if (added_pools.length) {
                    desc_string.push(`Added resources: ${added_pools.join(', ')}`);
                }
            }

            if (bucket) {
                Dispatcher.instance().activity({
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
                spillover: t.spillover || false,
                disabled: t.disabled || false
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
    var pools = [];

    _.forEach(policy.tiers, tier_and_order => {
        _.forEach(tier_and_order.tier.mirrors, mirror_object => {
            pools = _.concat(pools, mirror_object.spread_pools);
        });
    });
    pools = _.compact(pools);
    var pool_names = pools.map(pool => pool.name);
    return P.join(
            nodes_client.instance().aggregate_nodes_by_pool(pool_names, req.system._id),
            nodes_client.instance().aggregate_data_free_by_tier(
                policy.tiers.map(tiers_object => String(tiers_object.tier._id)), req.system._id)
        )
        .spread(function(nodes_aggregate_pool, aggregate_data_free_by_tier) {
            return get_tiering_policy_info(policy, nodes_aggregate_pool, aggregate_data_free_by_tier);
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

function get_tier_info(tier, nodes_aggregate_pool, aggregate_data_free_for_tier) {
    let mirrors_storage = [];
    let attached_pools = [];

    _.forEach(tier.mirrors, mirror_object => {
        let spread_storage;
        var pools_storage = _.map(mirror_object.spread_pools, pool =>
            _.defaults(_.get(nodes_aggregate_pool, ['groups', String(pool._id), 'storage']), {
                used: 0,
                total: 0,
                free: 0,
                unavailable_free: 0,
                used_other: 0,
                reserved: 0
            })
        );
        spread_storage = size_utils.reduce_storage(size_utils.reduce_sum, pools_storage);
        _.defaults(spread_storage, {
            used: 0,
            total: 0,
            free: 0,
            unavailable_free: 0,
            used_other: 0,
            reserved: 0
        });

        mirrors_storage.push(spread_storage);
        attached_pools = _.concat(attached_pools, mirror_object.spread_pools);
    });

    attached_pools = _.compact(attached_pools).map(pool => pool.name);

    const storage = _.defaults(
        size_utils.reduce_storage(size_utils.reduce_sum, mirrors_storage), {
            used: 0,
            total: 0,
            free: 0,
            unavailable_free: 0,
            used_other: 0,
            reserved: 0
        });

    const data = _.pick(_.defaults(
        size_utils.reduce_storage(size_utils.reduce_minimum, aggregate_data_free_for_tier), {
            free: 0,
        }), 'free');

    return {
        name: tier.name,
        chunk_coder_config: tier.chunk_config.chunk_coder_config,
        data_placement: tier.data_placement,
        attached_pools,
        storage,
        data,
    };
}

function get_tiering_policy_info(tiering_policy, nodes_aggregate_pool, aggregate_data_free_by_tier) {
    var info = _.pick(tiering_policy, 'name');
    var tiers_storage = nodes_aggregate_pool ? [] : null;
    var tiers_data = aggregate_data_free_by_tier ? [] : null;
    info.tiers = _.map(tiering_policy.tiers, function(tier_and_order) {
        if (tiers_storage) {
            var tier_info = get_tier_info(tier_and_order.tier,
                nodes_aggregate_pool,
                aggregate_data_free_by_tier[String(tier_and_order.tier._id)]);
            if (!tier_and_order.spillover) {
                tiers_storage.push(tier_info.storage);
                tiers_data.push(tier_info.data);
            }
        }
        return {
            order: tier_and_order.order,
            tier: tier_and_order.tier.name,
            spillover: tier_and_order.spillover || false,
            disabled: tier_and_order.disabled || false
        };
    });
    if (tiers_storage) {
        info.storage = size_utils.reduce_storage(size_utils.reduce_sum, tiers_storage);
    }
    if (tiers_data) {
        info.data = size_utils.reduce_storage(size_utils.reduce_sum, tiers_data);
    }
    return info;
}

function get_internal_storage_tier(system) {
    return system.tiers_by_name[`${config.SPILLOVER_TIER_NAME}-${system._id}`];
}

function get_associated_tiering_policies(tier) {
    var associated_tiering_policies = _.filter(tier.system.tiering_policies_by_name, function(tiering_policy) {
        return _.find(tiering_policy.tiers, tier_and_order =>
            String(tier_and_order.tier._id) === String(tier._id));
    });

    return _.map(associated_tiering_policies, tiering_policies => tiering_policies._id);
}

// EXPORTS
exports.get_associated_tiering_policies = get_associated_tiering_policies;
exports.get_internal_storage_tier = get_internal_storage_tier;
exports.new_tier_defaults = new_tier_defaults;
exports.new_policy_defaults = new_policy_defaults;
exports.new_chunk_code_config_defaults = new_chunk_code_config_defaults;
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
