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

    info.nodes = req.rpc_params.pool.nodes;
    dbg.log0('Creating new pool', info);
    return P.when(db.Pool.create(info))
        .then(null, db.check_already_exists(req, 'pool'))
        .thenResolve();
}

function update_pool(req) {
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
    return P.when(db.Pool
            .findOne(get_pool_query(req))
            .exec())
        .then(db.check_not_deleted(req, 'pool'))
        .then(function(pool) {
            current_nodes = pool.nodes;
            current_nodes = current_nodes.concat(req.rpc_params.nodes);
            current_nodes = _.uniq(current_nodes);
            var updates_pool = {
                nodes: current_nodes
            };
            return P.all([
                //Update Poll with nodes association
                db.Pool.findOneAndUpdate(get_pool_query(req), updates_pool).exec(),

                //Update node's reference to pool
                db.Node.update({
                    name: {
                        $in: req.rpc_params.nodes
                    }
                }, {
                    pool: pool
                }, {
                    multi: true
                })
                .exec()
            ]);
        });
}

function remove_nodes_from_pool(req) {
    dbg.log0('Removing ', req.rpc_params.nodes, 'from pool', req.rpc_params.name);
    var new_nodes;
    return P.all([db.Pool.findOne(get_pool_query(req)).exec(),
            db.Pool.findOne({
                system: req.system.id,
                name: 'default_pool',
                deleted: null,
            }).exec()
        ])
        .spread(function(pool, default_pool) {
            _.each(pool.nodes, function(n) {
                new_nodes[n] = true;
            });

            _.each(req.rpc_params.nodes, function(n) {
                if (new_nodes[n]) {
                    delete new_nodes[n];
                }
            });

            var updates_pool = {
                nodes: _.keys(new_nodes)
            };
            return P.all([
                //Update Poll with nodes de-association
                db.Pool.findOneAndUpdate(get_pool_query(req), updates_pool).exec(),

                //Update node's reference to default pool
                db.Node.update({
                    name: {
                        $in: req.rpc_params.nodes
                    }
                }, {
                    pool: default_pool
                }, {
                    multi: true
                })
                .exec()
            ]);
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
