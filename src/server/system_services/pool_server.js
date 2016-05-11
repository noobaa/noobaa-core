/**
 *
 * POOL_SERVER
 *
 */
'use strict';

const _ = require('lodash');
const os = require('os');
// const child_process = require('child_process');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const size_utils = require('../../util/size_utils');
const server_rpc = require('../server_rpc');
const ActivityLog = require('../analytic_services/activity_log');
const nodes_store = require('../node_services/nodes_store');
const system_store = require('../system_services/system_store').get_instance();
const SupervisorCtl = require('../utils/supervisor_ctrl');


function new_pool_defaults(name, system_id) {
    return {
        _id: system_store.generate_id(),
        system: system_id,
        name: name,
    };
}

function create_pool(req) {
    var name = req.rpc_params.name;
    var nodes = req.rpc_params.nodes;
    if (name !== 'default_pool' && nodes.length < config.NODES_MIN_COUNT) {
        throw req.rpc_error('NOT ENOUGH NODES', 'cant create a pool with less than ' +
            config.NODES_MIN_COUNT + ' nodes');
    }
    var pool = new_pool_defaults(name, req.system._id);
    dbg.log0('Creating new pool', pool);

    return system_store.make_changes({
            insert: {
                pools: [pool]
            }
        })
        .then(function() {
            return _assign_nodes_to_pool(req, pool);
        })
        .then((res) => {
            ActivityLog.create({
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
    var cloud_info = req.rpc_params.cloud_info;

    var pool = new_pool_defaults(name, req.system._id);
    dbg.log0('Creating new cloud_pool', pool);
    pool.cloud_pool_info = cloud_info;

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
                    endpoint: cloud_info.endpoint,
                    target_bucket: cloud_info.target_bucket,
                    access_keys: cloud_info.access_keys
                },
            });
        })
        .then(() => {
            // TODO: should we add different event for cloud pool?
            ActivityLog.create({
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
        throw req.rpc_error('ILLEGAL POOL RENAME', 'cant change name of default pool');
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
    return nodes_store.find_nodes({
            system: req.system._id,
            pool: pool._id,
            deleted: null
        }, {
            fields: {
                _id: 0,
                name: 1,
            }
        })
        .then(nodes => ({
            name: pool.name,
            nodes: _.map(nodes, 'name')
        }));
}

function read_pool(req) {
    var pool = find_pool_by_name(req);
    return nodes_store.aggregate_nodes_by_pool({
            system: req.system._id,
            pool: pool._id,
            deleted: null,
        })
        .then(function(nodes_aggregate_pool) {
            return get_pool_info(pool, nodes_aggregate_pool);
        });
}

function delete_pool(req) {
    dbg.log0('Deleting pool', req.rpc_params.name);
    var pool = find_pool_by_name(req);
    return nodes_store.aggregate_nodes_by_pool({
            system: req.system._id,
            pool: pool._id,
            deleted: null,
        })
        .then(function(nodes_aggregate_pool) {
            var reason = check_pool_deletion(pool, nodes_aggregate_pool);
            if (reason) {
                throw req.rpc_error(reason, 'Cannot delete pool');
            }
            return system_store.make_changes({
                remove: {
                    pools: [pool._id]
                }
            });
        })
        .then((res) => {
            ActivityLog.create({
                event: 'pool.delete',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
                desc: `${pool.name} was deleted by ${req.account && req.account.email}`,
            });
            return res;
        })
        .return();
}



function delete_cloud_pool(req) {
    dbg.log0('Deleting cloud pool', req.rpc_params.name);
    var pool = find_pool_by_name(req);

    // construct the cloud node name according to convention
    let cloud_node_name = 'noobaa-cloud-agent-' + os.hostname() + '-' + pool.name;
    return P.resolve()
        .then(function() {
            var reason = check_cloud_pool_deletion(pool);
            if (reason) {
                throw req.rpc_error(reason, 'Cannot delete pool');
            }
            return system_store.make_changes({
                remove: {
                    pools: [pool._id]
                }
            });
        })
        .then(() => SupervisorCtl.remove_agent(pool.name))
        .then(() => nodes_store.delete_node_by_name({
            system: {
                _id: req.system._id
            },
            rpc_params: {
                name: cloud_node_name
            }
        }))
        .then((res) => {
            ActivityLog.create({
                event: 'pool.delete',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
                desc: `${pool.name} was deleted by ${req.account && req.account.email}`,
            });
        })
        .return();
}


function _assign_nodes_to_pool(req, pool) {
    var assign_nodes = req.rpc_params.nodes;
    var nodes_before_change;
    return nodes_store.find_nodes({
            deleted: null,
            name: {
                $in: assign_nodes
            },
        }, {
            fields: {
                pool: 1,
                name: 1,
            }
        })
        .then(nodes_res => {
            nodes_before_change = nodes_res;
            return nodes_store.update_nodes({
                    system: req.system._id,
                    name: {
                        $in: assign_nodes
                    }
                }, {
                    $set: {
                        pool: pool._id,
                    }
                })
                .then(res => {
                    let desc_string = [];
                    desc_string.push(`${assign_nodes && assign_nodes.length} Nodes were assigned to ${pool.name} successfully by ${req.account && req.account.email}`);
                    _.forEach(nodes_before_change, node => {
                        desc_string.push(`${node.name} was assigned from ${node.pool.name} to ${pool.name}`);
                    });
                    ActivityLog.create({
                        event: 'pool.assign_nodes',
                        level: 'info',
                        system: req.system._id,
                        actor: req.account && req.account._id,
                        pool: pool._id,
                        desc: desc_string.join('\n'),
                    });
                    return res;
                });
        })
        .return();
}


function assign_nodes_to_pool(req) {
    dbg.log0('Adding nodes to pool', req.rpc_params.name, 'nodes', req.rpc_params.nodes);
    var pool = find_pool_by_name(req);
    return _assign_nodes_to_pool(req, pool);
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
        throw req.rpc_error('NO_SUCH_POOL', 'No such pool: ' + name);
    }
    return pool;
}

function get_pool_info(pool, nodes_aggregate_pool) {
    var n = nodes_aggregate_pool[pool._id] || {};
    var info = {
        name: pool.name,
        nodes: {
            count: n.count || 0,
            online: n.online || 0,
        },
        // notice that the pool storage is raw,
        // and does not consider number of replicas like in tier
        storage: size_utils.to_bigint_storage({
            total: n.total,
            free: n.free,
            used: n.used,
        })
    };
    var reason = check_pool_deletion(pool, nodes_aggregate_pool);
    if (reason) {
        info.undeletable = reason;
    }
    return info;
}

function check_pool_deletion(pool, nodes_aggregate_pool) {

    // Check if the default pool
    if (pool.name === 'default_pool') {
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


// EXPORTS
exports.new_pool_defaults = new_pool_defaults;
exports.get_pool_info = get_pool_info;
exports.create_pool = create_pool;
exports.create_cloud_pool = create_cloud_pool;
exports.update_pool = update_pool;
exports.list_pool_nodes = list_pool_nodes;
exports.read_pool = read_pool;
exports.delete_pool = delete_pool;
exports.delete_cloud_pool = delete_cloud_pool;
exports.assign_nodes_to_pool = assign_nodes_to_pool;
exports.get_associated_buckets = get_associated_buckets;
