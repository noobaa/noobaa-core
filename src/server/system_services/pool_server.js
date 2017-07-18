/* Copyright (C) 2016 NooBaa */
/**
 *
 * POOL_SERVER
 *
 */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const RpcError = require('../../rpc/rpc_error');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const Dispatcher = require('../notifications/dispatcher');
const nodes_client = require('../node_services/nodes_client');
const system_store = require('../system_services/system_store').get_instance();
const cloud_utils = require('../../util/cloud_utils');
const HistoryDataStore = require('../analytic_services/history_data_store').HistoryDataStore;

const POOL_STORAGE_DEFAULTS = Object.freeze({
    total: 0,
    free: 0,
    used_other: 0,
    unavailable_free: 0,
    used: 0,
    reserved: 0,
});
const POOL_NODES_INFO_DEFAULTS = Object.freeze({
    count: 0,
    online: 0,
    by_mode: {},
});

const POOL_HOSTS_INFO_DEFAULTS = Object.freeze({
    count: 0,
    by_mode: {},
    by_service: {},
});

const NO_CAPAITY_LIMIT = Math.pow(1024, 2); // 1MB
const LOW_CAPACITY_HARD_LIMIT = 50 * Math.pow(1024, 3); // 50GB

function new_pool_defaults(name, system_id, resource_type, pool_node_type) {
    return {
        _id: system_store.generate_id(),
        system: system_id,
        name: name,
        resource_type: resource_type,
        pool_node_type: pool_node_type
    };
}

function create_nodes_pool(req) {
    var name = req.rpc_params.name;
    var nodes = req.rpc_params.nodes;
    if (name !== config.NEW_SYSTEM_POOL_NAME && nodes.length < config.NODES_MIN_COUNT) {
        throw new RpcError('NOT ENOUGH NODES', 'cant create a pool with less than ' +
            config.NODES_MIN_COUNT + ' nodes');
    }
    var pool = new_pool_defaults(name, req.system._id, 'HOSTS', 'BLOCK_STORE_FS');
    dbg.log0('Creating new pool', pool);

    return system_store.make_changes({
            insert: {
                pools: [pool]
            }
        })
        .then(() => nodes_client.instance().migrate_nodes_to_pool(req.system._id, nodes,
            pool._id, req.account && req.account._id))
        .then(res => {
            Dispatcher.instance().activity({
                event: 'resource.create',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
                desc: `${name} was created by ${req.account && req.account.email}`,
            });
            return res;
        });
}

function create_hosts_pool(req) {
    const { rpc_params, auth_token } = req;
    const { name, hosts } = rpc_params;

    if (name !== config.NEW_SYSTEM_POOL_NAME && hosts.length < config.NODES_MIN_COUNT) {
        throw new RpcError(
            'NOT ENOUGH HOSTS',
            `cannot create a pool with less than ${config.NODES_MIN_COUNT} nodes`
        );
    }

    const pool = new_pool_defaults(name, req.system._id, 'HOSTS', 'BLOCK_STORE_FS');
    const pool_id = String(pool._id);
    dbg.log0('Creating new pool', pool);

    return P.resolve()
        .then(() => system_store.make_changes({
            insert: {
                pools: [pool]
            }
        }))
        .then(() => server_rpc.client.host.migrate_hosts_to_pool(
            { pool_id, hosts },
            { auth_token }
        ));
}

function create_cloud_pool(req) {
    var name = req.rpc_params.name;
    var connection = cloud_utils.find_cloud_connection(req.account, req.rpc_params.connection);
    var cloud_info = {
        endpoint: connection.endpoint,
        target_bucket: req.rpc_params.target_bucket,
        access_keys: {
            access_key: connection.access_key,
            secret_key: connection.secret_key,
            account_id: req.account._id
        },
        endpoint_type: connection.endpoint_type || 'AWS'
    };


    const already_used_by = cloud_utils.get_used_cloud_targets(cloud_info.endpoint_type,
            system_store.data.buckets, system_store.data.pools)
        .find(candidate_target => (candidate_target.endpoint === cloud_info.endpoint &&
            candidate_target.target_name === cloud_info.target_bucket));
    if (already_used_by) {
        dbg.error(`This endpoint is already being used by a ${already_used_by.usage_type}: ${already_used_by.source_name}`);
        throw new Error('Target already in use');
    }

    const pool_node_type = (connection.endpoint_type === 'AWS' ||
        connection.endpoint_type === 'S3_COMPATIBLE') ? 'BLOCK_STORE_S3' : 'BLOCK_STORE_AZURE';
    var pool = new_pool_defaults(name, req.system._id, 'CLOUD', pool_node_type);
    dbg.log0('Creating new cloud_pool', pool);
    pool.cloud_pool_info = cloud_info;

    dbg.log0('got connection for cloud pool:', connection);
    return system_store.make_changes({
            insert: {
                pools: [pool]
            }
        })
        .then(res => server_rpc.client.hosted_agents.create_pool_agent({
            pool_name: req.rpc_params.name,
        }, {
            auth_token: req.auth_token
        }))
        .then(() => {
            Dispatcher.instance().activity({
                event: 'resource.cloud_create',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
                desc: `${pool.name} was created by ${req.account && req.account.email}`,
            });
        })
        .return();
}

function create_mongo_pool(req) {
    var name = req.rpc_params.name;
    var mongo_info = {};

    if (get_internal_mongo_pool(req.system._id)) {
        dbg.error('System already has mongo pool');
        throw new Error('System already has mongo pool');
    }

    var pool = new_pool_defaults(name, req.system._id, 'INTERNAL', 'BLOCK_STORE_MONGO');
    dbg.log0('Creating new mongo_pool', pool);
    pool.mongo_pool_info = mongo_info;

    return system_store.make_changes({
            insert: {
                pools: [pool]
            }
        })
        .then(res => server_rpc.client.hosted_agents.create_pool_agent({
            pool_name: req.rpc_params.name,
        }, {
            auth_token: req.auth_token
        }))
        // .then(() => {
        //     Dispatcher.instance().activity({
        //         event: 'resource.cloud_create',
        //         level: 'info',
        //         system: req.system._id,
        //         actor: req.account && req.account._id,
        //         pool: pool._id,
        //         desc: `${pool.name} was created by ${req.account && req.account.email}`,
        //     });
        // })
        .return();
}

function list_pool_nodes(req) {
    var pool = find_pool_by_name(req);
    return P.resolve()
        .then(() => nodes_client.instance().list_nodes_by_pool(pool.name, req.system._id))
        .then(res => ({
            name: pool.name,
            nodes: _.map(res.nodes, node => {
                const reply = _.pick(node, '_id', 'name', 'peer_id', 'rpc_address');
                reply.id = String(reply._id);
                return _.omit(reply, '_id');
            })
        }));
}

function read_pool(req) {
    var pool = find_pool_by_name(req);
    return P.resolve()
        .then(() => nodes_client.instance().aggregate_nodes_by_pool([pool.name], req.system._id))
        .then(nodes_aggregate_pool => get_pool_info(pool, nodes_aggregate_pool));
}

function delete_pool(req) {
    var pool = find_pool_by_name(req);
    if (_is_regular_pool(pool)) {
        return _delete_nodes_pool(req.system, pool, req.account);
    } else {
        return _delete_resource_pool(req, pool, req.account);
    }
}


function _delete_nodes_pool(system, pool, account) {
    dbg.log0('Deleting pool', pool.name);
    return P.resolve()
        .then(() => nodes_client.instance().aggregate_nodes_by_pool([pool.name], system._id))
        .then(nodes_aggregate_pool => {
            var reason = check_pool_deletion(pool, nodes_aggregate_pool);
            if (reason) {
                throw new RpcError(reason, 'Cannot delete pool');
            }
            return system_store.make_changes({
                remove: {
                    pools: [pool._id]
                }
            });
        })
        .then(res => {
            Dispatcher.instance().activity({
                event: 'resource.delete',
                level: 'info',
                system: system._id,
                actor: account && account._id,
                pool: pool._id,
                desc: `${pool.name} was deleted by ${account && account.email}`,
            });
            return res;
        })
        .return();
}

function _delete_resource_pool(req, pool, account) {
    dbg.log0('Deleting resource pool', pool.name);
    var pool_name = pool.name;
    return P.resolve()
        .then(() => {
            const reason = check_resrouce_pool_deletion(pool);
            if (reason) {
                throw new RpcError(reason, 'Cannot delete pool');
            }
            return nodes_client.instance().list_nodes_by_pool(pool.name, req.system._id);
        })
        .then(function(pool_nodes) {
            if (!pool_nodes || pool_nodes.total_count === 0) {
                // handle edge case where the cloud pool is deleted before it's node is registered in nodes monitor.
                // in that case, send remove_cloud_agent to hosted_agents, which should also remove the pool.
                dbg.log0(`resource_pool ${pool_name} does not have any nodes in nodes_monitor. delete agent and pool from hosted_agents`);
                return server_rpc.client.hosted_agents.remove_pool_agent({
                    pool_name: pool.name
                }, {
                    auth_token: req.auth_token
                });
            }
            return P.each(pool_nodes && pool_nodes.nodes, node => {
                    nodes_client.instance().delete_node_by_name(req.system._id, node.name);
                })
                .then(function() {
                    // rename the deleted pool to avoid an edge case where there are collisions
                    // with a new resource pool name
                    let db_update = {
                        _id: pool._id,
                        name: pool.name + '-' + pool._id
                    };
                    const pending_del_property = pool.resource_type === 'INTERNAL' ?
                        'mongo_pool_info.pending_delete' : 'cloud_pool_info.pending_delete';
                    // mark the resource pool as pending delete
                    db_update[pending_del_property] = true;
                    return system_store.make_changes({
                        update: {
                            pools: [db_update]
                        }
                    });
                });

        })
        .then(() => {
            if (pool.resource_type === 'CLOUD') {
                Dispatcher.instance().activity({
                    event: 'resource.cloud_delete',
                    level: 'info',
                    system: req.system._id,
                    actor: account && account._id,
                    pool: pool._id,
                    desc: `${pool_name} was deleted by ${account && account.email}`,
                });
            }
        })
        .return();
}


function assign_nodes_to_pool(req) {
    dbg.log0('Adding nodes to pool', req.rpc_params.name, 'nodes', req.rpc_params.nodes);
    var pool = find_pool_by_name(req);
    return nodes_client.instance().migrate_nodes_to_pool(req.system._id, req.rpc_params.nodes,
        pool._id, req.account && req.account._id);
}


function assign_hosts_to_pool(req) {
    const { auth_token, rpc_params } = req;
    const { hosts, name } = rpc_params;
    dbg.log0('Adding hosts to pool', name, 'hosts:', hosts);

    const pool = find_pool_by_name(req);
    const pool_id = String(pool._id);
    return server_rpc.client.host.migrate_hosts_to_pool(
        { pool_id, hosts },
        { auth_token }
    );
}


function get_associated_buckets(req) {
    var pool = find_pool_by_name(req);
    return get_associated_buckets_int(pool);
}

function get_pool_history(req) {
    let pool_list = req.rpc_params.pool_list;
    return HistoryDataStore.instance().get_pool_history(pool_list);
}

// UTILS //////////////////////////////////////////////////////////

// TODO: JEN notice that does not include pools in disabled tiers
// What should we do in that case? Shall we delete the pool or not?
function get_associated_buckets_int(pool) {
    var associated_buckets = _.filter(pool.system.buckets_by_name, function(bucket) {
        return _.find(bucket.tiering.tiers, function(tier_and_order) {
            return _.find(tier_and_order.tier.mirrors, function(mirror) {
                return _.find(mirror.spread_pools, function(spread_pool) {
                    return String(pool._id) === String(spread_pool._id);
                });
            });
        });
    });

    return _.map(associated_buckets, function(bucket) {
        return bucket.name;
    });
}

function get_associated_accounts(pool) {
    return system_store.data.accounts
        .filter(account => (!account.is_support &&
            account.default_pool &&
            account.default_pool._id === pool._id
        ))
        .map(associated_account => associated_account.email);
}

function find_pool_by_name(req) {
    var name = req.rpc_params.name;
    var pool = req.system.pools_by_name[name];
    if (!pool) {
        throw new RpcError('NO_SUCH_POOL', 'No such pool: ' + name);
    }
    return pool;
}

function get_pool_info(pool, nodes_aggregate_pool, hosts_aggregate_pool) {
    const p_nodes = _.get(nodes_aggregate_pool, ['groups', String(pool._id)], {});
    const p_hosts = _.get(hosts_aggregate_pool, ['groups', String(pool._id)], { nodes: {} });
    var info = {
        name: pool.name,
        resource_type: pool.resource_type,
        pool_node_type: pool.pool_node_type,
        // notice that the pool storage is raw,
        // and does not consider number of replicas like in tier
        storage: _.defaults(size_utils.to_bigint_storage(p_hosts.storage), POOL_STORAGE_DEFAULTS)
    };
    if (p_nodes.data_activities) {
        info.data_activities = p_nodes.data_activities;
    }
    if (_is_cloud_pool(pool)) {
        info.cloud_info = {
            endpoint: pool.cloud_pool_info.endpoint,
            endpoint_type: pool.cloud_pool_info.endpoint_type || 'AWS',
            target_bucket: pool.cloud_pool_info.target_bucket
        };
        info.undeletable = check_resrouce_pool_deletion(pool);
        info.mode = calc_cloud_pool_mode(p_nodes);
    } else if (_is_mongo_pool(pool)) {
        info.mongo_info = {};
        info.undeletable = check_resrouce_pool_deletion(pool);
        info.mode = calc_mongo_pool_mode(p_nodes);
    } else {
        info.nodes = _.defaults({}, p_nodes.nodes, POOL_NODES_INFO_DEFAULTS);
        info.hosts = _.mapValues(POOL_HOSTS_INFO_DEFAULTS, (val, key) => p_hosts.nodes[key] || val);
        info.undeletable = check_pool_deletion(pool, nodes_aggregate_pool);
        info.mode = calc_hosts_pool_mode(info);
    }

    //Get associated accounts
    info.associated_accounts = get_associated_accounts(pool);

    return info;
}

function calc_cloud_pool_mode(p) {
    const { by_mode } = _.defaults({}, p.nodes, POOL_NODES_INFO_DEFAULTS);
    return (!p.nodes && 'INITALIZING') ||
        (by_mode.OPTIMAL && 'OPTIMAL') ||
        (by_mode.STORAGE_NOT_EXIST && 'STORAGE_NOT_EXIST') ||
        (by_mode.AUTH_FAILED && 'AUTH_FAILED') ||
        (by_mode.IO_ERRORS && 'IO_ERRORS') ||
        (by_mode.INITALIZING && 'INITALIZING') ||
        'ALL_NODES_OFFLINE';
}

function calc_mongo_pool_mode(p) {
    const { by_mode } = _.defaults({}, p.nodes, POOL_NODES_INFO_DEFAULTS);
    return (!p.nodes && 'INITALIZING') ||
        (by_mode.OPTIMAL && 'OPTIMAL') ||
        (by_mode.IO_ERRORS && 'IO_ERRORS') ||
        (by_mode.INITALIZING && 'INITALIZING') ||
        'ALL_NODES_OFFLINE';
}

function calc_hosts_pool_mode(pool_info) {
    const { hosts, storage, data_activities = [] } = pool_info;
    const { count, by_mode } = hosts;
    const { OFFLINE: offline, OPTIMAL: optimal } = by_mode;
    const offline_ratio = (offline / count) * 100;
    const { free, total, reserved, used_other } = _.assignWith({}, storage, (__, size) => size_utils.json_to_bigint(size));
    const potential_for_noobaa = total.subtract(reserved).subtract(used_other);
    const free_ratio = potential_for_noobaa.greater(0) ? free.multiply(100).divide(potential_for_noobaa) : size_utils.BigInteger.zero;
    const activity_count = data_activities
        .reduce((sum, val) => sum + val.count, 0);
    const activity_ratio = (activity_count / count) * 100;

    return (count === 0 && 'HAS_NO_NODES') ||
        (offline === count && 'ALL_NODES_OFFLINE') ||
        (count < 3 && 'NOT_ENOUGH_NODES') ||
        (optimal < 3 && 'NOT_ENOUGH_HEALTHY_NODES') ||
        (offline_ratio >= 30 && 'MANY_NODES_OFFLINE') ||
        (activity_ratio > 50 && 'HIGH_DATA_ACTIVITY') ||
        (free < NO_CAPAITY_LIMIT && 'NO_CAPACITY') ||
        (free < LOW_CAPACITY_HARD_LIMIT && 'LOW_CAPACITY') ||
        (free_ratio.lesserOrEquals(20) && 'LOW_CAPACITY') ||
        'OPTIMAL';
}

function check_pool_deletion(pool, nodes_aggregate_pool) {
    // Check if there are nodes till associated to this pool
    const nodes_count = _.get(nodes_aggregate_pool, [
        'groups', String(pool._id), 'nodes', 'count'
    ], 0);
    if (nodes_count) {
        return 'NOT_EMPTY';
    }

    //Verify pool is not used by any bucket/tier
    var buckets = get_associated_buckets_int(pool);
    if (buckets.length) {
        return 'IN_USE';
    }

    //Verify pool is not defined as default for any account
    var accounts = get_associated_accounts(pool);
    if (accounts.length) {
        return 'DEFAULT_RESOURCE';
    }
}


function check_resrouce_pool_deletion(pool) {

    //Verify pool is not used by any bucket/tier
    var buckets = get_associated_buckets_int(pool);
    if (buckets.length) {
        return 'IN_USE';
    }
}

function _is_cloud_pool(pool) {
    return Boolean(pool.cloud_pool_info);
}

function _is_mongo_pool(pool) {
    return Boolean(pool.mongo_pool_info);
}

function _is_regular_pool(pool) {
    return !(Boolean(pool.mongo_pool_info) || Boolean(pool.cloud_pool_info));
}

function get_internal_mongo_pool(system_id) {
    const system = system_store.data.systems.find(sys => String(sys._id) === String(system_id));
    if (!system) throw new Error('SYSTEM NOT FOUND', system_id);
    const mongo_pool = _.find(system.pools_by_name, pool =>
        String(pool.name) === String(`${config.INTERNAL_STORAGE_POOL_NAME}-${system_id}`));
    return mongo_pool;
}

// EXPORTS
exports.get_internal_mongo_pool = get_internal_mongo_pool;
exports.new_pool_defaults = new_pool_defaults;
exports.get_pool_info = get_pool_info;
exports.create_nodes_pool = create_nodes_pool;
exports.create_hosts_pool = create_hosts_pool;
exports.create_cloud_pool = create_cloud_pool;
exports.create_mongo_pool = create_mongo_pool;
exports.list_pool_nodes = list_pool_nodes;
exports.read_pool = read_pool;
exports.delete_pool = delete_pool;
exports.assign_hosts_to_pool = assign_hosts_to_pool;
exports.assign_nodes_to_pool = assign_nodes_to_pool;
exports.get_associated_buckets = get_associated_buckets;
exports.get_pool_history = get_pool_history;
