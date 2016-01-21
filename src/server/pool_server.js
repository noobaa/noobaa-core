'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');
var dbg = require('../util/debug_module')(__filename);
var system_store = require('./stores/system_store');
var size_utils = require('../util/size_utils');

/**
 *
 * POOL_SERVER
 *
 */
var pool_server = {
    new_pool_defaults: new_pool_defaults,
    get_pool_info: get_pool_info,
    create_pool: create_pool,
    update_pool: update_pool,
    list_pool_nodes: list_pool_nodes,
    read_pool: read_pool,
    delete_pool: delete_pool,
    add_nodes_to_pool: add_nodes_to_pool,
    remove_nodes_from_pool: remove_nodes_from_pool,
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
    if (name !== 'default_pool' && nodes.length < 3) {
        throw req.rpc_error('NOT ENOUGH NODES', 'cant create a pool with less than 3 nodes');
    }
    var pool = new_pool_defaults(name, req.system._id);
    dbg.log0('Creating new pool', pool);

    return system_store.make_changes({
            insert: {
                pools: [pool]
            }
        })
        .then(function() {
            return assign_nodes_to_pool(req.system._id, pool._id, nodes);
        });
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
    return P.when(db.Node.collection.find({
            system: req.system._id,
            pool: pool._id,
            deleted: null
        }, {
            fields: {
                _id: 0,
                name: 1,
            }
        }).toArray())
        .then(function(nodes) {
            return {
                name: pool.name,
                nodes: nodes
            };
        });
}

function read_pool(req) {
    var pool = find_pool_by_name(req);
    return P.when(db.Node.aggregate_nodes({
            system: req.system._id,
            pool: pool._id,
            deleted: null,
        }, 'pool'))
        .then(function(nodes_aggregate_pool) {
            return get_pool_info(pool, nodes_aggregate_pool);
        });
}

function delete_pool(req) {
    dbg.log0('Deleting pool', req.rpc_params.name);
    var pool = find_pool_by_name(req);
    return system_store.make_changes({
        remove: {
            pools: [pool._id]
        }
    }).return();
}

function assign_nodes_to_pool(system_id, pool_id, nodes_names) {
    return P.when(db.Node.collection.updateMany({
        system: system_id,
        name: {
            $in: nodes_names
        }
    }, {
        $set: {
            pool: pool_id,
        }
    })).return();
}

function unassign_nodes_from_pool(system_id, pool_id, nodes_names) {
    return P.when(db.Node.collection.updateMany({
        system: system_id,
        name: {
            $in: nodes_names
        },
        pool: pool_id,
    }, {
        $unset: {
            pool: 1,
        }
    })).return();
}


function add_nodes_to_pool(req) {
    dbg.log0('Adding nodes to pool', req.rpc_params.name, 'nodes', req.rpc_params.nodes);
    var pool = find_pool_by_name(req);
    return assign_nodes_to_pool(req.system._id, pool._id, req.rpc_params.nodes);
}

function remove_nodes_from_pool(req) {
    dbg.log0('Removing nodes from pool', req.rpc_params.name, 'nodes', req.rpc_params.nodes);
    var pool = find_pool_by_name(req);
    return unassign_nodes_from_pool(req.system._id, pool._id, req.rpc_params.nodes);
}

function get_associated_buckets(req) {
    var pool = find_pool_by_name(req);
    var associated_buckets = _.filter(req.system.buckets_by_name, function(bucket) {
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

// UTILS //////////////////////////////////////////////////////////

function find_pool_by_name(req) {
    var name = req.rpc_params.name;
    var pool = req.system.pools_by_name[name];
    if (!pool) {
        throw req.rpc_error('NOT_FOUND', 'POOL NOT FOUND ' + name);
    }
    return pool;
}

function get_pool_info(pool, nodes_aggregate_pool) {
    var n = nodes_aggregate_pool[pool._id] || {};
    return {
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
}
