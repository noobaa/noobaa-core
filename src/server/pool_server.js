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
    var info = _.pick(req.rpc_params.pool, 'name');
    info.system = req.system.id;

    if ((info.name !== 'default_pool') &&
        (req.rpc_params.pool.nodes.length < 3)) {
        throw req.rpc_error('NOT ENOUGH NODES', 'cant create a pool with less than 3 nodes');
    }

    info.nodes = req.rpc_params.pool.nodes;
    dbg.log0('Creating new pool', info);
    return P.when(db.Pool.create(info))
        .then(null, db.check_already_exists(req, 'pool'))
        .thenResolve();
}

function update_pool(req) {
    if ((req.rpc_params.name === 'default_pool') &&
        (req.rpc_params.new_name !== 'default_pool')) {
        throw req.rpc_error('ILLEGAL POOL RENAME', 'cant change name of default pool');
    }
    dbg.log0('Update pool', req.rpc_params.name, 'to', req.rpc_params.new_name);
    return P.when(db.Pool
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
    return P.when(db.Pool
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
    return P.when(db.Pool
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
    dbg.log0('Adding', req.rpc_params.nodes, 'to pool', req.rpc_params.name);
    var current_nodes;
    var pool;
    return P.when(db.Pool
            .findOne(get_pool_query(req))
            .exec())
        .then(db.check_not_deleted(req, 'pool'))
        .then(function(p) {
            pool = p;
            current_nodes = pool.nodes;
            current_nodes = current_nodes.concat(req.rpc_params.nodes);
            current_nodes = _.uniq(current_nodes);
            var updates = {
                nodes: current_nodes
            };
            return P.when(db.Pool
                .findOneAndUpdate(get_pool_query(req), updates)
                .exec());
        })
        .then(function() {
            return P.when(db.Node
                .update({
                    name: {
                        $in: current_nodes
                    }
                }, {
                    $set: {
                        pool: pool.id,
                    }
                }, {
                    multi: true
                })
                .exec());
        });
}

function remove_nodes_from_pool(req) {
    dbg.log0('Removing ', req.rpc_params.nodes, 'from pool', req.rpc_params.name);
    var new_nodes;
    return P.when(db.Pool
            .findOne(get_pool_query(req))
            .exec())
        .then(db.check_not_deleted(req, 'pool'))
        .then(function(pool) {
            _.each(pool.nodes, function(n) {
                new_nodes[n] = true;
            });

            _.each(req.rpc_params.nodes, function(n) {
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
        })
        .then(function() {
            return P.when(db.pool
                .findOne({
                    system: req.system.id,
                    name: 'defaut_pool',
                    deleted: null,
                })
                .exec());
        })
        .then(function(p) {
            return P.when(db.Node
                .update({
                    name: {
                        $in: _.keys(new_nodes)
                    }
                }, {
                    $set: {
                        pool: p.id,
                    }
                }, {
                    multi: true
                })
                .exec());
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
