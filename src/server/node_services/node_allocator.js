/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const chance = require('chance')();
const util = require('util');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const nodes_client = require('./nodes_client');
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();
const db_client = require('../../util/db_client');
// const node_server = require('./node_server');

const ALLOC_REFRESH_MS = 10000;

const report_error_on_node_alloc_symbol = Symbol('report_error_on_node_alloc_symbol');
const nodes_alloc_round_robin_symbol = Symbol('nodes_alloc_round_robin_symbol');

/**
 * @typedef {Object} PoolAllocGroup
 * @property {number} last_refresh
 * @property {Promise|P} promise
 * @property {nb.NodeAPI[]} nodes
 * @property {{nodes:nb.NodeAPI[]}[]} latency_groups
 *
 * @typedef {Object} PoolSetAllocGroup
 * @property {{nodes:nb.NodeAPI[]}[]} latency_groups
 *
 * @typedef {Object} TieringAllocGroup
 * @property {number} last_refresh
 * @property {Promise|P} promise
 * @property {{ [tier_id: string]: nb.MirrorStatus[] }} mirrors_storage_by_tier_id
 *
 */

/** @type {{ [pool_id: string]: PoolAllocGroup }} */
let alloc_group_by_pool = {};
/** @type {{ [pool_set: string]: PoolSetAllocGroup }} */
let alloc_group_by_pool_set = {};
/** @type {{ [tiering_id: string]: TieringAllocGroup }} */
let alloc_group_by_tiering = {};

/**
 * @param {nb.System} system
 * @returns {Promise<void>}
 *
 * Refresh allocation for all tiers for a given system.
 * This funciton should be used instead of  calling refersh_tiering_alloc
 * for each tiering policy in the system in a loop because it prefvent duplicate
 * refreshs_pools_allocs for the same pools.
 */
async function refresh_system_alloc(system) {
    // Bail out if the index does not exists (in case there are
    // no buckets in the system)
    if (!system.buckets_by_name) {
        return;
    }

    const tiering_list = [];
    const pool_set = new Set();

    for (const bucket of Object.values(system.buckets_by_name)) {
        if (!bucket.tiering) continue;
        tiering_list.push(bucket.tiering);

        // realted to https://bugzilla.redhat.com/show_bug.cgi?id=1839117
        // print information in case bucket.tiering is not iterable. should happen when the tiering is deleted and the bucket is not
        if (!bucket.tiering.tiers) {
            if (db_client.instance().is_object_id(bucket.tiering)) {
                try {
                    const deleted_tiering = await system_store.data.get_by_id_include_deleted(bucket.tiering, 'tieringpolicies');
                    dbg.error(`bucket.tiering.tiers is undefined\\null. bucket=${
                        util.inspect(bucket, { depth: 5 })
                    } tiering_policy=${
                        util.inspect(deleted_tiering, { depth: 5 })
                    }`);
                } catch (err) {
                    dbg.error(err);
                }
            } else {
                dbg.error(`bucket.tiering.tiers is undefined\\null. bucket=`, util.inspect(bucket, { depth: 5 }));
            }
        }

        for (const { tier } of bucket.tiering.tiers) {
            for (const mirror of tier.mirrors) {
                for (const pool of mirror.spread_pools) {
                    pool_set.add(pool);
                }
            }
        }
    }

    await Promise.all([
        // Refresh pools promise list
        ...Array.from(pool_set).map(
            pool => refresh_pool_alloc(pool)
        ),

        // Refresh tiers promise list
        refresh_tiers_alloc(tiering_list)
    ]);
}

/**
 * @param {nb.Tiering} tiering
 * @param {'force'} [force]
 * @returns {Promise<void>}
 */
async function refresh_tiering_alloc(tiering, force) {
    const pools = _.flatMap(tiering && tiering.tiers, ({ tier }) => {
        let tier_pools = [];
        // Inside the Tier, pools are unique and we don't need to filter afterwards
        _.forEach(tier.mirrors, mirror_object => {
            tier_pools = _.concat(tier_pools, mirror_object.spread_pools);
        });
        return tier_pools;
    });
    if (force === 'force') {
        await server_rpc.client.node.sync_monitor_storage_info(undefined, {
            auth_token: auth_server.make_auth_token({
                system_id: tiering.system._id,
                role: 'admin'
            })
        });
    }
    await Promise.all([
        P.map(pools, pool => refresh_pool_alloc(pool, force)).then(() => { /*void*/ }),
        refresh_tiers_alloc((tiering && [tiering]) || [], force),
    ]);
}

/**
 * @param {nb.Pool} pool
 * @param {'force'} [force]
 * @returns {Promise<void>}
 */
async function refresh_pool_alloc(pool, force) {
    const pool_id_str = pool._id.toHexString();
    let group = alloc_group_by_pool[pool_id_str];
    if (!group) {
        group = {
            promise: undefined,
            last_refresh: 0,
            nodes: [],
            latency_groups: undefined,
        };
        alloc_group_by_pool[pool_id_str] = group;
    }

    dbg.log2('refresh_pool_alloc: checking pool', pool._id, 'group', group);

    if (force !== 'force') {
        // cache the nodes for some time before refreshing
        if (Date.now() < group.last_refresh + ALLOC_REFRESH_MS) {
            return;
        }
    }

    if (group.promise) return group.promise;

    group.promise = P.resolve()
        .then(() => nodes_client.instance().allocate_nodes(pool.system._id, pool._id))
        .then(res => {
            group.last_refresh = Date.now();
            group.promise = null;
            group.latency_groups = res.latency_groups;
            dbg.log1('refresh_pool_alloc: updated pool', pool.name,
                'nodes', _.map(_.flatMap(group.latency_groups, 'nodes'), 'name'));
            _.each(alloc_group_by_pool_set, (g, pool_set) => {
                if (_.includes(pool_set, String(pool._id))) {
                    dbg.log1('invalidate alloc_group_by_pool_set for', pool_set,
                        'on change to pool', pool._id);
                    delete alloc_group_by_pool_set[pool_set];
                }
            });
        }, err => {
            group.promise = null;
            throw err;
        });

    return group.promise;
}


/**
 * @param {nb.Tiering[]} tiering_list
 * @param {'force'} [force]
 * @returns {Promise<void>}
 */

async function refresh_tiers_alloc(tiering_list, force) {
    if (tiering_list.length === 0) {
        return;
    }
    const system_id = tiering_list[0].tiers[0].tier.system._id;
    const update_list = [];
    const wait_list = [];

    for (const tiering of tiering_list) {
        const tiering_id_str = tiering._id.toHexString();
        let group = alloc_group_by_tiering[tiering_id_str];
        if (!group) {
            group = {
                promise: undefined,
                last_refresh: 0,
                mirrors_storage_by_tier_id: {},
            };
            alloc_group_by_tiering[tiering_id_str] = group;
        }

        if (force !== 'force') {
            // cache the nodes for some time before refreshing
            if (Date.now() < group.last_refresh + ALLOC_REFRESH_MS) {
                continue;
            }
        }

        if (group.promise) {
            wait_list.push(group.promise);
            continue;
        }

        const tiers = tiering.tiers.map(tier_and_order => String(tier_and_order.tier._id));
        update_list.push({ group, tiers });
    }

    if (update_list.length > 0) {
        const tiers_to_refresh = _.flatMap(update_list, item => item.tiers);
        const promise = P.resolve()
            .then(async () => {
                const aggr_by_tier = await nodes_client.instance().aggregate_data_free_by_tier(tiers_to_refresh, system_id);
                for (const { group, tiers } of update_list) {
                    group.promise = null;
                    group.last_refresh = Date.now();
                    group.mirrors_storage_by_tier_id = _.pick(aggr_by_tier, tiers);
                }
            })
            .catch(err => {
                for (const { group } of update_list) {
                    group.promise = null;
                }
                throw err;
            });

        for (const { group } of update_list) {
            group.promise = promise;
        }

        wait_list.push(promise);
    }

    await Promise.all(wait_list);
    return null;
}

/**
 * @param {nb.Tiering} tiering
 * @returns {nb.TieringStatus}
 */
function get_tiering_status(tiering) {
    /** @type {nb.TieringStatus} */
    const tiering_status_by_tier = {};
    if (!tiering) return tiering_status_by_tier;
    const tiering_id_str = tiering._id.toHexString();
    const alloc_group = alloc_group_by_tiering[tiering_id_str];
    _.each(tiering.tiers, ({ tier }) => {
        const tier_id_str = tier._id.toHexString();
        const mirrors_storage = alloc_group && alloc_group.mirrors_storage_by_tier_id[tier_id_str];
        let tier_pools = [];
        // Inside the Tier, pools are unique and we don't need to filter afterwards
        _.each(tier.mirrors, mirror_object => {
            tier_pools = _.concat(tier_pools, mirror_object.spread_pools);
        });

        const ccc = _.get(tier, 'chunk_config.chunk_coder_config');
        const required_valid_nodes = ccc ? (ccc.data_frags + ccc.parity_frags) * ccc.replicas : config.NODES_MIN_COUNT;
        tiering_status_by_tier[tier_id_str] = {
            pools: _get_tier_pools_status(tier_pools, required_valid_nodes),
            mirrors_storage,
        };
    });
    return tiering_status_by_tier;
}

/**
 * @param {nb.Pool[]} pools
 * @param {number} required_valid_nodes
 * @returns {nb.PoolsStatus}
 */
function _get_tier_pools_status(pools, required_valid_nodes) {
    /** @type {nb.PoolsStatus} */
    const pools_status_by_id = {};
    _.each(pools, pool => {
        let valid_for_allocation = true;
        let alloc_group = alloc_group_by_pool[String(pool._id)];
        const num_nodes = alloc_group ? _.sumBy(alloc_group.latency_groups, 'nodes.length') : 0;
        if (pool.cloud_pool_info) {
            if (num_nodes !== config.NODES_PER_CLOUD_POOL) {
                valid_for_allocation = false;
            }
        } else if (pool.mongo_pool_info) {
            if (num_nodes !== config.NODES_PER_MONGO_POOL) {
                valid_for_allocation = false;
            }
        } else if (num_nodes < required_valid_nodes) {
            valid_for_allocation = false;
        }
        pools_status_by_id[pool._id.toHexString()] = {
            valid_for_allocation,
            num_nodes,
            resource_type: pool.resource_type
        };
    });
    return pools_status_by_id;
}



/**
 * @param {object} params
 * @property {string[]} avoid_nodes array of node ids to avoid
 * @property {string[]} allocated_hosts array of node ids to avoid
 * @property {nb.Pool[]} pools
 * @returns {nb.NodeAPI}
 */
function allocate_node({ avoid_nodes, allocated_hosts, pools = [] }) {
    let pool_set = _.map(pools, pool => String(pool._id)).sort().join(',');
    let alloc_group = alloc_group_by_pool_set[pool_set];

    if (!alloc_group) {
        const pools_latency_groups = [{ nodes: [] }];
        // TODO:
        // We allocate using pool sets and not single pools
        // This is why we need to somehow merge the KMEANS of each pool into an aggregated pool set
        // It is a problem which breaks the KMEANS groups since we just merge the groups by index
        // Example of the problematic case:
        // Pool A: Has 20 slow nodes (It will be divided to 2 slow groups)
        // Pool B: Has 20 fast nodes (It will be divided to 2 fast groups)
        // Since we will merge the two groups we will eventually have two average groups
        // This is bad since we will have two groups with each having fast and slow drives
        pools.forEach(pool => {
            let group = alloc_group_by_pool[pool._id.toHexString()];
            if (group && group.latency_groups) {
                group.latency_groups.forEach((value, index) => {
                    if (pools_latency_groups[index]) {
                        pools_latency_groups[index].nodes =
                            _.concat(pools_latency_groups[index].nodes, value.nodes);
                    } else {
                        pools_latency_groups[index] = value;
                    }
                });
            }
        });
        alloc_group = {
            latency_groups: _.map(pools_latency_groups, group => ({
                nodes: chance.shuffle(group.nodes)
            }))
        };
        alloc_group_by_pool_set[pool_set] = alloc_group;
    }

    const num_nodes = alloc_group ? _.sumBy(alloc_group.latency_groups, 'nodes.length') : 0;

    dbg.log1('allocate_node: pool_set', pool_set,
        'num_nodes', num_nodes,
        'alloc_group', alloc_group);

    if (num_nodes < 1) {
        // await P.map(pools, pool => refresh_pool_alloc(pool, 'force'));
        dbg.error('allocate_node: no nodes for allocation in pool set',
            pools, avoid_nodes, allocated_hosts);
        return;
    }

    const ALLOC_BEST = { unique_hosts: true, use_nodes_with_errors: false };
    const ALLOC_ALLOW_SAME_HOST = { unique_hosts: false, use_nodes_with_errors: false };
    const ALLOC_ALLOW_ANY = { unique_hosts: false, use_nodes_with_errors: true };

    let node;
    alloc_group.latency_groups.forEach(group => {
        if (node) return false; // This is done in order to break the loop
        node = allocate_from_list(group.nodes, avoid_nodes, allocated_hosts, ALLOC_BEST) ||
            allocate_from_list(group.nodes, avoid_nodes, allocated_hosts, ALLOC_ALLOW_SAME_HOST);
    });
    if (node) return node;
    alloc_group.latency_groups.forEach(group => {
        if (node) return false; // This is done in order to break the loop
        node = allocate_from_list(group.nodes, avoid_nodes, allocated_hosts, ALLOC_ALLOW_ANY);
    });
    return node;
}


/**
 * @param {nb.NodeAPI[]} nodes
 * @param {string[]} avoid_nodes array of node ids to avoid
 * @param {string[]} allocated_hosts array of node ids to avoid
 * @param {Object} options
 */
function allocate_from_list(nodes, avoid_nodes, allocated_hosts, options) {
    for (var i = 0; i < nodes.length; ++i) {
        var node = get_round_robin(nodes);
        if (Boolean(options.use_nodes_with_errors) ===
            Boolean(node[report_error_on_node_alloc_symbol]) &&
            !_.includes(avoid_nodes, String(node._id)) &&
            (!_.includes(allocated_hosts, node.host_id) || !options.unique_hosts)) {
            dbg.log1('allocate_node: allocated node', node.name,
                'avoid_nodes', avoid_nodes);
            return node;
        }
    }
}

/**
 * @param {nb.NodeAPI[]} nodes
 * @returns {nb.NodeAPI}
 */
function get_round_robin(nodes) {
    var rr = (nodes[nodes_alloc_round_robin_symbol] || 0) % nodes.length;
    nodes[nodes_alloc_round_robin_symbol] = rr + 1;
    return nodes[rr];
}

/**
 * find the node in the memory groups and mark the error time
 * @param {nb.ID} node_id
 */
function report_error_on_node_alloc(node_id) {
    _.each(alloc_group_by_pool, (group, pool_id) => {
        _.each(group.nodes, node => {
            if (String(node._id) === String(node_id)) {
                node[report_error_on_node_alloc_symbol] = new Date();
            }
        });
    });
}


// EXPORTS
exports.get_tiering_status = get_tiering_status;
exports.refresh_system_alloc = refresh_system_alloc;
exports.refresh_tiering_alloc = refresh_tiering_alloc;
exports.refresh_pool_alloc = refresh_pool_alloc;
exports.allocate_node = allocate_node;
exports.report_error_on_node_alloc = report_error_on_node_alloc;
