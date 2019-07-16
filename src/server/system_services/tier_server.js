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
const node_allocator = require('../node_services/node_allocator');
const system_store = require('./system_store').get_instance();
const chunk_config_utils = require('../utils/chunk_config_utils');


function new_tier_defaults(name, system_id, chunk_config, mirrors) {
    return {
        _id: system_store.new_system_store_id(),
        name: name,
        system: system_id,
        chunk_config,
        data_placement: 'SPREAD',
        mirrors,
    };
}

function new_policy_defaults(name, system_id, chunk_split_config, tiers_orders) {
    return {
        _id: system_store.new_system_store_id(),
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
        chunk_config._id = system_store.new_system_store_id();
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
            return get_tier_info(tier, nodes_aggregate_pool, { mirror_storage: available_to_upload[String(tier._id)] });
        });
}


function _convert_pools_to_data_placement_structure(pool_ids, data_placement) {
    let mirrors = [];
    if (data_placement === 'MIRROR') {
        _.forEach(pool_ids, pool_id => mirrors.push({
            _id: system_store.new_system_store_id(),
            spread_pools: [pool_id]
        }));
    } else {
        mirrors.push({
            _id: system_store.new_system_store_id(),
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
            chunk_config._id = system_store.new_system_store_id();
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
        });
}



/**
 *
 * DELETE_TIER
 *
 */
function delete_tier(req) {
    dbg.log0('Deleting tier', req.rpc_params.name, 'on', req.system._id);
    const tier = find_tier_by_name(req);
    return system_store.make_changes({ remove: { tiers: [tier._id] } });
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

function update_chunk_config_for_bucket(req) { // please remove when CCC is per tier and not per policy
    var bucket = req.system.buckets_by_name[req.rpc_params.bucket_name];
    if (!bucket) {
        dbg.error('BUCKET NOT FOUND', req.rpc_params.bucket_name);
        throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.bucket_name);
    }
    const policy = bucket.tiering;
    const changes = {
        insert: {},
        update: {},
    };
    const chunk_config = chunk_config_utils.resolve_chunk_config(
        req.rpc_params.chunk_coder_config, req.account, req.system);
    if (!chunk_config._id) {
        chunk_config._id = system_store.new_system_store_id();
        changes.insert.chunk_configs = [chunk_config];
    }
    changes.update.tiers = policy.tiers.map(t => ({
        _id: t.tier._id,
        chunk_config: chunk_config._id
    }));
    return system_store.make_changes(changes);
}

function add_tier_to_bucket(req) {
    var bucket = req.system.buckets_by_name[req.rpc_params.bucket_name];
    if (!bucket) {
        dbg.error('BUCKET NOT FOUND', req.rpc_params.bucket_name);
        throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + req.rpc_params.bucket_name);
    }
    const policy = bucket.tiering;
    const tier_params = req.rpc_params.tier;
    const changes = { insert: {}, update: {} };
    const policy_pool_ids = _.map(tier_params.attached_pools,
        pool_name => req.system.pools_by_name[pool_name]._id
    );
    const mirrors = _convert_pools_to_data_placement_structure(policy_pool_ids, req.rpc_params.data_placement);
    const info = req.system.tiering_policies_by_name[policy.name.unwrap()];
    const tier0_ccc = info.tiers[0].tier.chunk_config.chunk_coder_config;
    let chunk_config = chunk_config_utils.resolve_chunk_config(
        req.rpc_params.chunk_coder_config || tier0_ccc, req.account, req.system);

    const new_tier_name = bucket.name + '#' + Date.now().toString(36);
    const tier = new_tier_defaults(
        new_tier_name,
        req.system._id,
        chunk_config._id,
        mirrors
    );
    changes.insert.tiers = [tier];
    const order = req.rpc_params.tier.order || policy.tiers.length;
    if (order < 0 || order > policy.tiers.length) {
        throw new RpcError('ILLEGAL_ORDER', `tier order ${order} is not allowed`);
    }
    const new_tiers = Array.from(policy.tiers);
    new_tiers.splice(order, 0, {
        order: order,
        tier: tier,
        spillover: tier_params.spillover || false,
        disabled: tier_params.disabled || false
    });
    changes.update.tieringpolicies = [{
        _id: policy._id,
        tiers: new_tiers.map((t, index) => ({
            order: index,
            tier: t.tier._id,
            spillover: t.spillover,
            disabled: t.disabled,
        })),
        chunk_split_config: policy.chunk_split_config
    }];
    return system_store.make_changes(changes);
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
            nodes_client.instance().aggregate_hosts_by_pool(pool_names, req.system._id),
        )
        .spread(function(nodes_aggregate_pool, hosts_aggregate_pool) {
            return get_tiering_policy_info(policy,
                node_allocator.get_tiering_status(policy),
                nodes_aggregate_pool,
                hosts_aggregate_pool);
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

function find_tier_by_name(req, tier_name) {
    const name = tier_name || req.rpc_params.name;
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

function get_tier_extra_info(tier, tiering_pools_status, nodes_aggregate_pool, hosts_aggregate_pool) {
    const info = {
        has_any_pool_configured: false,
        num_nodes_in_mirror_group: 0,
        num_valid_nodes: 0,
        num_valid_hosts: 0,
        mirrors_with_valid_pool: 0,
        mirrors_with_enough_nodes: 0,
        has_internal_or_cloud_pool: false,
        use_internal: false,
        has_valid_pool: false,
        any_rebuilds: false,
    };
    const ccc = tier.chunk_config.chunk_coder_config;
    const required_valid_nodes = ccc ? (ccc.data_frags + ccc.parity_frags) * ccc.replicas : config.NODES_MIN_COUNT;
    const tiering_pools_used_agg = [0];
    tier.mirrors.forEach(mirror_object => {
        _.compact((mirror_object.spread_pools || []).map(pool => {
                info.has_any_pool_configured = true;
                const spread_pool = system_store.data.pools.find(pool_rec => String(pool_rec._id) === String(pool._id));
                tiering_pools_used_agg.push(_.get(spread_pool, 'storage_stats.blocks_size') || 0);
                return _.extend({ pool_id: pool._id }, tiering_pools_status[tier._id].pools[pool._id]);
            }))
            .forEach(pool_status => {
                info.any_rebuilds = info.any_rebuilds || _.get(nodes_aggregate_pool, `groups.${pool_status.pool_id}.data_activities.length`);
                const pool_num_nodes = _.get(nodes_aggregate_pool, `groups.${pool_status.pool_id}.storage_nodes.count`) || 0;
                const pool_num_hosts = _.get(hosts_aggregate_pool, `groups.${pool_status.pool_id}.nodes.online`) || 0;
                info.num_nodes_in_mirror_group += pool_num_nodes;
                info.num_valid_nodes += (pool_status.num_nodes || 0);
                info.num_valid_hosts += (pool_num_hosts || 0);
                info.has_valid_pool = info.has_valid_pool || pool_status.valid_for_allocation;
                info.has_internal_or_cloud_pool = info.has_internal_or_cloud_pool || (pool_status.resource_type !== 'HOSTS');
                info.use_internal = info.use_internal || (pool_status.resource_type === 'INTERNAL');
            });
        if (info.has_valid_pool || ((info.num_valid_nodes || 0) >= required_valid_nodes)) info.mirrors_with_valid_pool += 1;
        if (info.num_nodes_in_mirror_group >= required_valid_nodes || info.has_internal_or_cloud_pool) info.mirrors_with_enough_nodes += 1;

        const existing_minimum = _.isUndefined(info.num_of_nodes) ? Number.MAX_SAFE_INTEGER : info.num_of_nodes;
        const existing_hosts_minimum = _.isUndefined(info.num_of_hosts) ? Number.MAX_SAFE_INTEGER : info.num_of_hosts;
        const num_valid_nodes_for_minimum = _.isUndefined(info.num_valid_nodes) ? Number.MAX_SAFE_INTEGER : info.num_valid_nodes;
        const potential_new_minimum = info.has_internal_or_cloud_pool ?
            Number.MAX_SAFE_INTEGER : num_valid_nodes_for_minimum;
        info.num_of_nodes = info.use_internal ? 0 : Math.min(existing_minimum, potential_new_minimum);
        const potential_new_hosts_minimum = info.has_internal_or_cloud_pool ?
            Number.MAX_SAFE_INTEGER : info.num_valid_hosts;
        info.num_of_hosts = info.use_internal ? 0 : Math.min(existing_hosts_minimum, potential_new_hosts_minimum);
    });
    info.num_of_nodes = info.num_of_nodes || 0;
    info.num_of_hosts = info.num_of_hosts || 0;
    info.node_tolerance = ccc.parity_frags ?
        Math.max(info.num_of_nodes - ccc.parity_frags, 0) :
        Math.max(info.num_of_nodes - 1, 0);
    info.host_tolerance = ccc.parity_frags ?
        Math.max(info.num_of_hosts - ccc.parity_frags, 0) :
        Math.max(info.num_of_hosts - 1, 0);
    info.used_of_pools_in_tier = size_utils.json_to_bigint(size_utils.reduce_sum('blocks_size', tiering_pools_used_agg));
    return info;
}

function get_tier_info(tier, nodes_aggregate_pool, tiering_tier_status) {
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
        size_utils.reduce_storage(size_utils.reduce_minimum, tiering_tier_status && tiering_tier_status.mirrors_storage), {
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

function get_tiering_policy_info(tiering_policy, tiering_pools_status,
    nodes_aggregate_pool, hosts_aggregate_pool) {
    const info = _.pick(tiering_policy, 'name');
    const tiers_storage = nodes_aggregate_pool ? [] : null;
    const tiers_data = tiering_pools_status ? [] : null;
    info.tiers = _.map(tiering_policy.tiers, t => {
        let mode;
        if (tiers_storage) {
            const extra_info = get_tier_extra_info(t.tier, tiering_pools_status, nodes_aggregate_pool, hosts_aggregate_pool);
            const tier_info = get_tier_info(t.tier,
                nodes_aggregate_pool,
                tiering_pools_status[String(t.tier._id)]);
            tiers_storage.push(tier_info.storage);
            tiers_data.push(tier_info.data);
            mode = calc_tier_policy_status(t.tier, tier_info, extra_info);
        }
        return {
            order: t.order,
            tier: t.tier.name,
            spillover: t.spillover || false,
            disabled: t.disabled || false,
            mode: mode || 'OPTIMAL',
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

function calc_tier_policy_status(tier, tier_info, extra_info) {
    let has_enough_healthy_nodes_for_tier = false;
    let has_enough_total_nodes_for_tier = false;
    let is_no_storage = false;
    let is_storage_low = false;

    const tier_free = size_utils.json_to_bigint(_.get(tier_info, 'storage.free') || 0);
    const tier_used = size_utils.json_to_bigint(_.get(tier_info, 'storage.used') || 0);
    const tier_used_other = size_utils.json_to_bigint(_.get(tier_info, 'storage.used_other') || 0);
    const tier_total = tier_free.plus(tier_used).plus(tier_used_other);
    // const low_tolerance = (extra_info.node_tolerance === 0 || extra_info.host_tolerance === 0);
    if (tier_free.isZero()) {
        is_no_storage = true;
    } else {
        let free_percent = tier_free.multiply(100).divide(tier_total);
        if (free_percent < 30) {
            is_storage_low = true;
        }
    }
    if (tier.mirrors.length > 0) {
        if (extra_info.mirrors_with_valid_pool === tier.mirrors.length) has_enough_healthy_nodes_for_tier = true;
        if (extra_info.mirrors_with_enough_nodes === tier.mirrors.length) has_enough_total_nodes_for_tier = true;
    }
    if (extra_info.use_internal && extra_info.mirrors_with_valid_pool === 0) {
        return 'INTERNAL_STORAGE_ISSUES';
    }
    if (!extra_info.has_any_pool_configured) {
        return 'NO_RESOURCES';
    }
    if (!has_enough_total_nodes_for_tier) {
        return 'NOT_ENOUGH_RESOURCES';
    }
    if (!has_enough_healthy_nodes_for_tier) {
        return 'NOT_ENOUGH_HEALTHY_RESOURCES';
    }
    if (is_no_storage) {
        return 'NO_CAPACITY';
    }
    if (is_storage_low) {
        return 'LOW_CAPACITY';
    }
    return 'OPTIMAL';
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
exports.get_tier_extra_info = get_tier_extra_info;
exports.get_tiering_policy_info = get_tiering_policy_info;
exports.update_chunk_config_for_bucket = update_chunk_config_for_bucket;
//Tiers
exports.create_tier = create_tier;
exports.read_tier = read_tier;
exports.update_tier = update_tier;
exports.delete_tier = delete_tier;
//Tiering Policy
exports.create_policy = create_policy;
exports.update_policy = update_policy;
exports.add_tier_to_bucket = add_tier_to_bucket;
exports.get_policy_pools = get_policy_pools;
exports.read_policy = read_policy;
exports.delete_policy = delete_policy;
