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
const system_store = require('./system_store').get_instance();
const chunk_config_utils = require('../utils/chunk_config_utils');


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

function new_policy_defaults(name, system_id, chunk_split_config, tiers_orders) {
    return {
        _id: system_store.generate_id(),
        name: name,
        system: system_id,
        tiers: tiers_orders,
        chunk_split_config: _.defaults(chunk_split_config, {
            avg_chunk: config.CHUNK_SPLIT_AVG_CHUNK,
            delta_chunk: config.CHUNK_SPLIT_DELTA_CHUNK,
        }),
    };
}

/**
 *
 * CREATE_TIER
 *
 */
function create_tier(req) {
    const changes = { insert: {} };

    const policy_pool_ids = _.map(req.rpc_params.attached_pools,
        pool_name => req.system.pools_by_name[pool_name]._id
    );

    const chunk_config = chunk_config_utils.resolve_chunk_config(
        req.rpc_params.chunk_coder_config, req.account, req.system);
    if (!chunk_config._id) {
        chunk_config._id = system_store.generate_id();
        changes.insert.chunk_configs = [chunk_config];
    }

    const mirrors = _convert_pools_to_data_placement_structure(policy_pool_ids, req.rpc_params.data_placement);

    const tier = new_tier_defaults(
        req.rpc_params.name,
        req.system._id,
        chunk_config._id,
        mirrors
    );
    if (req.rpc_params.data_placement) tier.data_placement = req.rpc_params.data_placement;
    changes.insert.tiers = [tier];

    dbg.log0('Creating new tier', tier);
    return system_store.make_changes(changes)
        .then(function() {
            req.load_auth();
            const created_tier = find_tier_by_name(req);
            return get_tier_info(created_tier);
        });
}



/**
 *
 * READ_TIER
 *
 */
function read_tier(req) {
    const tier = find_tier_by_name(req);
    const pool_names = [];

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
            _id: system_store.generate_id(),
            spread_pools: [pool_id]
        }));
    } else {
        mirrors.push({
            _id: system_store.generate_id(),
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
    const tier = find_tier_by_name(req);
    const updates = {
        _id: tier._id
    };
    const changes = {
        insert: {},
        update: { tiers: [updates] },
    };


    if (req.rpc_params.new_name) {
        updates.name = req.rpc_params.new_name;
    }

    let chunk_config_changed = false;
    if (req.rpc_params.chunk_coder_config) {
        const chunk_config = chunk_config_utils.resolve_chunk_config(
            req.rpc_params.chunk_coder_config, req.account, req.system);
        if (!chunk_config._id) {
            chunk_config._id = system_store.generate_id();
            changes.insert.chunk_configs = [chunk_config];
        }
        if (chunk_config !== tier.chunk_config) {
            updates.chunk_config = chunk_config._id;
            chunk_config_changed = true;
        }
    }


    let old_pool_names = [];
    if (req.rpc_params.data_placement) {
        updates.data_placement = req.rpc_params.data_placement;
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
    }

    return system_store.make_changes(changes)
        .then(res => {
            const bucket = find_bucket_by_tier(req);
            if (bucket) {
                if (req.rpc_params.data_placement) { //Placement policy changes
                    const desc_string = [];
                    let policy_type_change = String(tier.data_placement) === String(req.rpc_params.data_placement) ? 'No changes' :
                        `Changed to ${req.rpc_params.data_placement} from ${tier.data_placement}`;
                    let removed_pools = _.difference(old_pool_names, req.rpc_params.attached_pools || []);
                    let added_pools = _.difference(req.rpc_params.attached_pools || [], old_pool_names);
                    desc_string.push(`Bucket policy was changed by: ${req.account && req.account.email.unwrap()}`);
                    desc_string.push(`Policy type: ${policy_type_change}`);
                    if (removed_pools.length) {
                        desc_string.push(`Removed resources: ${removed_pools.join(', ')}`);
                    }
                    if (added_pools.length) {
                        desc_string.push(`Added resources: ${added_pools.join(', ')}`);
                    }
                    Dispatcher.instance().activity({
                        event: 'bucket.edit_policy',
                        level: 'info',
                        system: req.system._id,
                        actor: req.account && req.account._id,
                        bucket: bucket._id,
                        desc: desc_string.join('\n'),
                    });
                }

                if (req.rpc_params.chunk_coder_config && chunk_config_changed) {
                    const new_cc_type = req.rpc_params.chunk_coder_config.parity_frags ? 'Erasure Coding' : 'Replication';
                    const old_cc_type = tier.chunk_config.chunk_coder_config.parity_frags ? 'Erasure Coding' : 'Replication';
                    let desc_string;
                    if (new_cc_type === old_cc_type) {
                        desc_string = `Data resiliency configuration was updated to ${new_cc_type}. `;
                    } else {
                        desc_string = `Data resiliency type was changed from ${old_cc_type} to ${new_cc_type}`;
                    }
                    if (new_cc_type === 'Replication') {
                        desc_string += `\nNumber of replicas: ${req.rpc_params.chunk_coder_config.replicas}`;
                    } else {
                        desc_string += `\nNumber of data fragments: ${req.rpc_params.chunk_coder_config.data_frags}`;
                        desc_string += `\nNumber of parity fragments: ${req.rpc_params.chunk_coder_config.parity_frags}`;
                    }
                    Dispatcher.instance().activity({
                        event: 'bucket.edit_resiliency',
                        level: 'info',
                        system: req.system._id,
                        actor: req.account && req.account._id,
                        bucket: bucket._id,
                        desc: desc_string,
                    });
                }

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
    const tier = find_tier_by_name(req);
    return system_store.make_changes({ remove: { tiers: [tier._id] } }).return();
}




// TIERING POLICY /////////////////////////////////////////////////

function create_policy(req) {
    const policy = policy_defaults_from_req(req);
    dbg.log0('Creating tiering policy', policy);
    return system_store.make_changes({ insert: { tieringpolicies: [policy] } })
        .then(() => {
            req.load_auth();
            const created_policy = find_policy_by_name(req);
            return get_tiering_policy_info(created_policy);
        });
}

function update_policy(req) {
    const policy = find_policy_by_name(req);
    const policy_defaults = policy_defaults_from_req(req);
    const updates = _.pick(policy_defaults, 'chunk_split_config', 'tiers');
    if (_.isEmpty(updates)) return;
    updates._id = policy._id;
    return system_store.make_changes({ update: { tieringpolicies: [updates] } })
        .then(() => {
            req.load_auth();
            const created_policy = find_policy_by_name(req);
            return get_tiering_policy_info(created_policy);
        });

}

function get_policy_pools(req) {
    const policy = find_policy_by_name(req);
    return get_tiering_policy_info(policy);
}

function read_policy(req) {
    const policy = find_policy_by_name(req);
    let pools = [];

    _.forEach(policy.tiers, t => {
        _.forEach(t.tier.mirrors, mirror_object => {
            pools = _.concat(pools, mirror_object.spread_pools);
        });
    });
    pools = _.compact(pools);
    const pool_names = pools.map(pool => pool.name);
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
    const policy = find_policy_by_name(req);
    return system_store.make_changes({
        remove: {
            tieringpolicies: [policy._id]
        }
    });
}


// UTILS //////////////////////////////////////////////////////////

function find_bucket_by_tier(req) {
    const tier = find_tier_by_name(req);
    const policy = _.find(system_store.data.tieringpolicies,
        p => _.find(p.tiers, t => String(t.tier._id) === String(tier._id))
    );

    if (!policy) {
        return null;
        //throw new RpcError('NOT_FOUND', 'POLICY OF TIER NOT FOUND ' + tier.name);
    }

    const bucket = _.find(system_store.data.buckets,
        bkt => String(bkt.tiering._id) === String(policy._id)
    );

    if (!bucket) {
        return null;
        //throw new RpcError('NOT_FOUND', 'BUCKET OF TIER POLICY NOT FOUND ' + policy.name);
    }

    return bucket;
}

function find_tier_by_name(req) {
    const name = req.rpc_params.name;
    const tier = req.system.tiers_by_name[name.unwrap()];
    if (!tier) {
        throw new RpcError('NO_SUCH_TIER', 'No such tier: ' + name);
    }
    return tier;
}

function find_policy_by_name(req) {
    const name = req.rpc_params.name;
    const policy = req.system.tiering_policies_by_name[name.unwrap()];
    if (!policy) {
        throw new RpcError('NO_SUCH_TIERING_POLICY', 'No such tiering policy: ' + name);
    }
    return policy;
}

function policy_defaults_from_req(req) {
    return new_policy_defaults(
        req.rpc_params.name,
        req.system._id,
        req.rpc_params.chunk_split_config,
        _.map(req.rpc_params.tiers, t => ({
            order: t.order,
            tier: req.system.tiers_by_name[t.tier.unwrap()]._id,
            spillover: t.spillover || false,
            disabled: t.disabled || false
        }))
    );
}

function get_tier_info(tier, nodes_aggregate_pool, aggregate_data_free_for_tier) {
    const mirrors_storage = [];
    let attached_pools = [];
    const mirror_groups = [];

    _.forEach(tier.mirrors, mirror => {
        let spread_storage;
        const pools_storage = _.map(mirror.spread_pools, pool =>
            _.defaults(_.get(nodes_aggregate_pool, ['groups', String(pool._id), 'storage']), {
                used: 0,
                total: 0,
                free: 0,
                unavailable_free: 0,
                unavailable_used: 0,
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
            unavailable_used: 0,
            used_other: 0,
            reserved: 0
        });

        mirrors_storage.push(spread_storage);
        attached_pools = _.concat(attached_pools, mirror.spread_pools);
        mirror_groups.push({
            name: String(mirror._id),
            pools: _.map(mirror.spread_pools, 'name')
        });
    });

    attached_pools = _.compact(attached_pools).map(pool => pool.name);

    const storage = _.defaults(
        size_utils.reduce_storage(size_utils.reduce_sum, mirrors_storage), {
            used: 0,
            total: 0,
            free: 0,
            unavailable_free: 0,
            unavailable_used: 0,
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
        mirror_groups,
        storage,
        data,
    };
}

function get_tiering_policy_info(tiering_policy, nodes_aggregate_pool, aggregate_data_free_by_tier) {
    const info = _.pick(tiering_policy, 'name');
    const tiers_storage = nodes_aggregate_pool ? [] : null;
    const tiers_data = aggregate_data_free_by_tier ? [] : null;
    info.tiers = _.map(tiering_policy.tiers, t => {
        if (tiers_storage) {
            const tier_info = get_tier_info(t.tier,
                nodes_aggregate_pool,
                aggregate_data_free_by_tier[String(t.tier._id)]);
            if (!t.spillover) {
                tiers_storage.push(tier_info.storage);
                tiers_data.push(tier_info.data);
            }
        }
        return {
            order: t.order,
            tier: t.tier.name,
            spillover: t.spillover || false,
            disabled: t.disabled || false
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

function get_associated_tiering_policies(tier) {
    const associated_tiering_policies = _.filter(tier.system.tiering_policies_by_name,
        policy => _.find(policy.tiers, t => String(t.tier._id) === String(tier._id))
    );

    return _.map(associated_tiering_policies, tiering_policies => tiering_policies._id);
}


// EXPORTS
exports.get_associated_tiering_policies = get_associated_tiering_policies;
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
