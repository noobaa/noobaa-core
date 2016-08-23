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
const cloud_utils = require('../utils/cloud_utils');


function new_pool_defaults(name, system_id) {
    return {
        _id: system_store.generate_id(),
        system: system_id,
        name: name,
    };
}

function create_nodes_pool(req) {
    var name = req.rpc_params.name;
    var nodes = req.rpc_params.nodes;
    if (name !== 'default_pool' && nodes.length < config.NODES_MIN_COUNT) {
        throw new RpcError('NOT ENOUGH NODES', 'cant create a pool with less than ' +
            config.NODES_MIN_COUNT + ' nodes');
    }
    var pool = new_pool_defaults(name, req.system._id);
    dbg.log0('Creating new pool', pool);

    return system_store.make_changes({
            insert: {
                pools: [pool]
            }
        })
        .then(() => nodes_client.instance().migrate_nodes_to_pool(nodes, pool._id))
        .then(res => {
            Dispatcher.instance().activity({
                event: 'pool.create',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
                desc: `${name} was created by ${req.account && req.account.email}`,
            });
            return res;
        });
}


function create_cloud_pool(req) {
    var name = req.rpc_params.name;
    var connection = cloud_utils.find_cloud_connection(req.account, req.rpc_params.connection);
    var cloud_info = {
        endpoint: connection.endpoint,
        target_bucket: req.rpc_params.target_bucket,
        access_keys: {
            access_key: connection.access_key,
            secret_key: connection.secret_key
        }
    };

    var pool = new_pool_defaults(name, req.system._id);
    dbg.log0('Creating new cloud_pool', pool);
    pool.cloud_pool_info = cloud_info;

    dbg.log0('got connection for cloud pool:', connection);
    return system_store.make_changes({
            insert: {
                pools: [pool]
            }
        })
        .then(res => {
            let sys_access_keys = system_store.data.accounts[1].access_keys[0];
            return server_rpc.client.hosted_agents.create_agent({
                name: req.rpc_params.name,
                access_keys: sys_access_keys,
                cloud_info: {
                    endpoint: connection.endpoint,
                    target_bucket: req.rpc_params.target_bucket,
                    access_keys: {
                        access_key: connection.access_key,
                        secret_key: connection.secret_key
                    }
                },
            });
        })
        .then(() => {
            // TODO: should we add different event for cloud pool?
            Dispatcher.instance().activity({
                event: 'pool.create',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
                desc: `${pool.name} was created by ${req.account && req.account.email}`,
            });
        })
        .return();
}



function update_pool(req) {
    var name = req.rpc_params.name;
    var new_name = req.rpc_params.new_name;
    if ((name === 'default_pool') !== (new_name === 'default_pool')) {
        throw new RpcError('ILLEGAL POOL RENAME', 'cant change name of default pool');
    }
    var pool = find_pool_by_name(req);
    dbg.log0('Update pool', name, 'to', new_name);
    return system_store.make_changes({
        update: {
            pools: [{
                _id: pool._id,
                name: new_name
            }]
        }
    }).return();
}

function list_pool_nodes(req) {
    var pool = find_pool_by_name(req);
    return P.resolve()
        .then(() => nodes_client.instance().list_nodes_by_pool(pool._id))
        .then(res => ({
            name: pool.name,
            nodes: _.map(res.nodes, node =>
                _.pick(node, 'id', 'name', 'peer_id', 'rpc_address'))
        }));
}

function read_pool(req) {
    var pool = find_pool_by_name(req);
    return P.resolve()
        .then(() => nodes_client.instance().aggregate_nodes_by_pool([pool._id]))
        .then(function(nodes_aggregate_pool) {
            return get_pool_info(pool, nodes_aggregate_pool);
        });
}

function delete_pool(req) {
    var pool = find_pool_by_name(req);
    if (_is_cloud_pool(pool)) {
        return _delete_cloud_pool(req.system, pool, req.account);
    } else {
        return _delete_nodes_pool(req.system, pool, req.account);
    }
}


function _delete_nodes_pool(system, pool, account) {
    dbg.log0('Deleting pool', pool.name);
    return P.resolve()
        .then(() => nodes_client.instance().aggregate_nodes_by_pool([pool._id]))
        .then(function(nodes_aggregate_pool) {
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
                event: 'pool.delete',
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

function _delete_cloud_pool(system, pool, account) {
    dbg.log0('Deleting cloud pool', pool.name);

    return P.resolve()
        .then(function() {
            var reason = check_cloud_pool_deletion(pool);
            if (reason) {
                throw new RpcError(reason, 'Cannot delete pool');
            }
            return system_store.make_changes({
                remove: {
                    pools: [pool._id]
                }
            });
        })
        .then(() => server_rpc.client.hosted_agents.remove_agent({
            name: pool.name
        }))
        .then(() => {
            Dispatcher.instance().activity({
                event: 'pool.delete',
                level: 'info',
                system: system._id,
                actor: account && account._id,
                pool: pool._id,
                desc: `${pool.name} was deleted by ${account && account.email}`,
            });
        })
        .return();
}


function assign_nodes_to_pool(req) {
    dbg.log0('Adding nodes to pool', req.rpc_params.name, 'nodes', req.rpc_params.nodes);
    var pool = find_pool_by_name(req);
    return nodes_client.instance().migrate_nodes_to_pool(
        req.rpc_params.nodes, pool._id);
}


function get_associated_buckets(req) {
    var pool = find_pool_by_name(req);
    return get_associated_buckets_int(pool);
}

// UTILS //////////////////////////////////////////////////////////

function get_associated_buckets_int(pool) {
    var associated_buckets = _.filter(pool.system.buckets_by_name, function(bucket) {
        return _.find(bucket.tiering.tiers, function(tier_and_order) {
            return _.find(tier_and_order.tier.pools, function(pool2) {
                return String(pool._id) === String(pool2._id);
            });
        });
    });

    return _.map(associated_buckets, function(bucket) {
        return bucket.name;
    });
}

function find_pool_by_name(req) {
    var name = req.rpc_params.name;
    var pool = req.system.pools_by_name[name];
    if (!pool) {
        throw new RpcError('NO_SUCH_POOL', 'No such pool: ' + name);
    }
    return pool;
}

function get_pool_info(pool, nodes_aggregate_pool) {
    var n = nodes_aggregate_pool[pool._id] || {};
    var info = {
        name: pool.name,
        // notice that the pool storage is raw,
        // and does not consider number of replicas like in tier
        storage: size_utils.to_bigint_storage({
            total: n.total,
            free: n.free,
            used_other: n.used_other,
            unavailable_free: n.unavailable_free,
            used: n.used,
            reserved: n.reserved,
        })
    };
    if (_is_cloud_pool(pool)) {
        info.cloud_info = {
            endpoint: pool.cloud_pool_info.endpoint,
            target_bucket: pool.cloud_pool_info.target_bucket
        };
        info.undeletable = check_cloud_pool_deletion(pool, nodes_aggregate_pool);
    } else {
        info.nodes = {
            count: n.count || 0,
            online: n.online || 0,
            has_issues: n.has_issues || 0,
        };

        info.undeletable = check_pool_deletion(pool, nodes_aggregate_pool);
        info.demo_pool = Boolean(pool.demo_pool);
    }

    return info;
}

function check_pool_deletion(pool, nodes_aggregate_pool) {

    // Check if the default pool
    if (pool.name === 'default_pool' || pool.name === config.DEMO_DEFAULTS.POOL_NAME) {
        return 'SYSTEM_ENTITY';
    }

    // Check if there are nodes till associated to this pool
    var n = nodes_aggregate_pool[pool._id] || {};
    if (n.count) {
        return 'NOT_EMPTY';
    }

    //Verify pool is not used by any bucket/tier
    var buckets = get_associated_buckets_int(pool);
    if (buckets.length) {
        return 'IN_USE';
    }
}


function check_cloud_pool_deletion(pool) {

    //Verify pool is not used by any bucket/tier
    var buckets = get_associated_buckets_int(pool);
    if (buckets.length) {
        return 'IN_USE';
    }
}


function _is_cloud_pool(pool) {
    return Boolean(pool.cloud_pool_info);
}


// EXPORTS
exports.new_pool_defaults = new_pool_defaults;
exports.get_pool_info = get_pool_info;
exports.create_nodes_pool = create_nodes_pool;
exports.create_cloud_pool = create_cloud_pool;
exports.update_pool = update_pool;
exports.list_pool_nodes = list_pool_nodes;
exports.read_pool = read_pool;
exports.delete_pool = delete_pool;
exports.assign_nodes_to_pool = assign_nodes_to_pool;
exports.get_associated_buckets = get_associated_buckets;
