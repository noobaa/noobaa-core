'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var db = require('./db');
var dbg = require('../util/debug_module')(__filename);

/**
 *
 * POOL_SERVER
 *
 */
var pool_server = {
    create_pool: create_pool,
    update_pool: update_pool,
    get_pool: get_pool,
    delete_pool: delete_pool,
    add_nodes_to_pool: add_nodes_to_pool,
    remove_nodes_from_pool: remove_nodes_from_pool,
};

module.exports = pool_server;


function create_pool(req) {
    var info;
    info.name = req.rpc_params.name;
    info.system = req.system.id;
    return P.when(resolve_nodes_ids(req.system.id, req.rpc_params.nodes))
        .then(function(nodes) {
            info.nodes = nodes;
            dbg.log0('Creating new pool', info);
            return P.when(db.Pools.create(info))
                .then(null, db.check_already_exists(req, 'pool'))
                .thenResolve();
        });
}

function update_pool(req) {
    dbg.log0('Update pool', req.rpc_params.name, 'to', req.rpc_params.new_name);
    return P.when(db.Pools
            .findOne(get_pool_query(req))
            .exec())
        .then(db.check_not_deleted(req, 'pool'))
        .then(function(pool) {
            var updates = {
                name: req.rpc_params.new_name
            };
            return P.when(db.Pool
                .findOneAndUpdate(get_pool_query(req), updates)
                .exec());
        });
}

function get_pool(req) {
    return P.when(db.Pools
            .findOne(get_pool_query(req))
            .populate('node')
            .exec())
        .then(db.check_not_deleted(req, 'pool'))
        .then(function(pool) {
            var reply;
            reply.name = req.rpc_params.name;
            reply.nodes = _.pluck(pool.nodes, 'name');
            return reply;
        });
}

function delete_pool(req) {
    dbg.log0('Deleting pool', req.rpc_params.name);
    return P.when(db.Pools
            .findOne(get_pool_query(req))
            .exec())
        .then(db.check_not_deleted(req, 'pool'))
        .then(function(pool) {
            var updates = {
                deleted: new Date()
            };
            return P.when(db.Pool
                .findOneAndUpdate(get_pool_query(req), updates)
                .exec());
        });
}

function add_nodes_to_pool(req) {
    dbg.log0('Adding nodes to pool', req.rpc_params.name);
    var current_nodes;
    return P.when(db.Pools
            .findOne(get_pool_query(req))
            .exec())
        .then(db.check_not_deleted(req, 'pool'))
        .then(function(pool) {
            current_nodes = pool.nodes;
            return P.when(resolve_nodes_ids(req.system.id, req.rpc_params.nodes))
                .then(function(new_nodes) {
                    current_nodes = current_nodes.concat(new_nodes);
                    current_nodes = _.uniq(current_nodes);
                    var updates = {
                        nodes: current_nodes
                    };
                    return P.when(db.Pool
                        .findOneAndUpdate(get_pool_query(req), updates)
                        .exec());
                });
        });
}

function remove_nodes_from_pool(req) {
    dbg.log0('Removing nodes to pool', req.rpc_params.name);
    var new_nodes;
    return P.when(db.Pools
            .findOne(get_pool_query(req))
            .exec())
        .then(db.check_not_deleted(req, 'pool'))
        .then(function(pool) {
            _.each(pool.nodes, function(n) {
                new_nodes[n] = true;
            });
            return P.when(resolve_nodes_ids(req.system.id, req.rpc_params.nodes))
                .then(function(removed_nodes) {
                    _.each(removed_nodes, function(n) {
                        if (new_nodes[n]) {
                            delete new_nodes[n];
                        }
                    });

                    var updates = {
                        nodes: _.keys(new_nodes)
                    };
                    return P.when(db.Pool
                        .findOneAndUpdate(get_pool_query(req), updates)
                        .exec());
                });
        });
}

// UTILS //////////////////////////////////////////////////////////

function get_pool_query(req) {
    return {
        system: req.system.id,
        name: req.rpc_params.name,
        deleted: null,
    };
}

//Recieves an array of node names, return an array of nodes IDs
function resolve_nodes_ids(system, nodes) {
    return P.when(db.Nodes
            .find({
                system: system,
                name: {
                    $in: nodes
                }
            })
            .exec())
        .then(function(query_nodes) {
            return _.pluck(query_nodes, '_id');
        });
}
