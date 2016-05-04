'use strict';

var _ = require('lodash');
// var P = require('../util/promise');
var dbg = require('../util/debug_module')(__filename);
var system_store = require('./stores/system_store');
var nodes_store = require('./stores/nodes_store');
var size_utils = require('../util/size_utils');
var config = require('../../config');
var db = require('./db');
var child_process = require('child_process');
var P = require('../util/promise');
var os = require('os');
var SupervisorCtl = require('../server/utils/supervisor_ctrl');

/**
 *
 * POOL_SERVER
 *
 */
var pool_server = {
    new_pool_defaults: new_pool_defaults,
    get_pool_info: get_pool_info,
    create_pool: create_pool,
    create_cloud_pool: create_cloud_pool,
    update_pool: update_pool,
    list_pool_nodes: list_pool_nodes,
    read_pool: read_pool,
    delete_pool: delete_pool,
    delete_cloud_pool: delete_cloud_pool,
    assign_nodes_to_pool: assign_nodes_to_pool,
    get_associated_buckets: get_associated_buckets,
};

module.exports = pool_server;

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
            return _assign_nodes_to_pool(req.system._id, pool._id, nodes);
        })
        .then((res) => {
            db.ActivityLog.create({
                event: 'pool.create',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
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
            let args = [
                '--cloud_endpoint', cloud_info.endpoint,
                '--cloud_bucket', cloud_info.target_bucket,
                '--cloud_access_key', cloud_info.access_keys.access_key,
                '--cloud_secret_key', cloud_info.access_keys.secret_key,
                '--cloud_pool_name', name,
                '--internal_agent'
            ];

            dbg.log0('adding agent to supervior with arguments:', _.join(args, ' '));
            return SupervisorCtl.add_agent(name, _.join(args, ' '));
        })
        .then(() => {
            // TODO: should we add different event for cloud pool?
            db.ActivityLog.create({
                event: 'pool.create',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
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
            db.ActivityLog.create({
                event: 'pool.delete',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
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
        .then(() => SupervisorCtl.remove_program('agent_' + pool.name))
        .then(() => SupervisorCtl.apply_changes())
        .then(() => nodes_store.delete_node_by_name({
            system: {
                _id: req.system._id
            },
            rpc_params: {
                name: cloud_node_name
            }
        }))
        .then((res) => {
            db.ActivityLog.create({
                event: 'pool.delete',
                level: 'info',
                system: req.system._id,
                actor: req.account && req.account._id,
                pool: pool._id,
            });
        })
        .return();
}


function _assign_nodes_to_pool(system_id, pool_id, nodes_names) {
    return nodes_store.update_nodes({
        system: system_id,
        name: {
            $in: nodes_names
        }
    }, {
        $set: {
            pool: pool_id,
        }
    }).return();
}


function assign_nodes_to_pool(req) {
    dbg.log0('Adding nodes to pool', req.rpc_params.name, 'nodes', req.rpc_params.nodes);
    var pool = find_pool_by_name(req);
    db.ActivityLog.create({
        event: 'pool.assign_nodes',
        level: 'info',
        system: req.system._id,
        actor: req.account && req.account._id,
        pool: pool._id,
    });
    return _assign_nodes_to_pool(req.system._id, pool._id, req.rpc_params.nodes);
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
