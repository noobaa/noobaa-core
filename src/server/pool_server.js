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
    new_pool_defaults: new_pool_defaults,
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
        _id: db.new_object_id(),
        system: system_id,
        name: name,
        nodes: [],
    };
}


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
        .then(function(newp) {
            //If any of the associated nodes already belong to a different pool => move them
            return P.when(db.Node
                    .find({
                        system: req.system.id,
                        name: {
                            $in: info.nodes
                        }
                    }))
                .then(function(nodes) {
                    //Remove nodes from their pools
                    var pools_to_nodes = {};
                    _.each(nodes, function(n) {
                        if (!pools_to_nodes[n.pool]) {
                            pools_to_nodes[n.pool] = [n.name];
                        } else {
                            pools_to_nodes[n.pool].push(n.name);
                        }
                    });
                    return P.all(_.map(pools_to_nodes, function(pool, i) {
                        return P.when(db.Pool.findOne({
                                system: req.system.id,
                                _id: i,
                                deleted: null,
                            }))
                            .then(function(pname) {
                                return remove_nodes_from_pool({
                                    system: {
                                        id: req.system.id
                                    },
                                    rpc_params: {
                                        nodes: pool,
                                        name: pname.name,
                                    }
                                });
                            });
                    }));
                })
                .then(function() {
                    //Update the nodes themselves
                    return P.when(db.Node
                        .update({
                            name: {
                                $in: info.nodes
                            }
                        }, {
                            $set: {
                                pool: newp._id,
                            }
                        }, {
                            multi: true
                        })
                        .exec());
                });
        })
        .then(function() {
            dbg.log0('New pool created', info);
            return;
        });
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
        })
        .return();
}

function list_pool_nodes(req) {
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

function read_pool(req) {
    var reply;
    var pool;
    return P.when(db.Pool
            .findOne(get_pool_query(req))
            .populate('node')
            .exec())
        .then(db.check_not_deleted(req, 'pool'))
        .then(function(p) {
            pool = p;
            return P.when(db.Node.aggregate_nodes({
                system: req.system.id,
                deleted: null,
            }, 'pool'));
        })
        .then(function(aggr) {
            var aggregate_p = aggr[pool._id] || {};
            reply = {
                name: pool.name,
                total_nodes: pool.nodes.length,
                online_nodes: aggregate_p.online || 0,
                //TODO:: in tier we divide by number of replicas, in pool we have no such concept
                storage: {
                    total: (aggregate_p.total || 0),
                    free: (aggregate_p.free || 0),
                    used: (aggregate_p.used || 0),
                    alloc: (aggregate_p.alloc || 0)
                }
            };
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
        })
        .return();
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
        })
        .return();
}

function remove_nodes_from_pool(req) {
    dbg.log0('Removing ', req.rpc_params.nodes, 'from pool', req.rpc_params.name);
    var new_nodes = {};
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
            return P.when(db.Pool
                .findOne({
                    system: req.system.id,
                    name: 'default_pool',
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
                        pool: p._id,
                    }
                }, {
                    multi: true
                })
                .exec());
        })
        .return();
}

function get_associated_buckets(req) {
    var pool;
    var associated_tiers = [];
    var associated_policies = [];

    return P.when(db.Pool
            .findOne(get_pool_query(req))
            .exec())
        .then(function(p) {
            pool = p;
            return P.when(db.Tier
                .find({
                    system: req.system.id,
                    deleted: null,
                })
                .exec());
        })
        .then(function(tiers) {
            _.each(tiers, function(t) {
                _.each(t.pools, function(current_pool) {
                    if (pool._id.toString() === current_pool.toString()) {
                        associated_tiers.push(t._id.toString());
                    }
                });
            });

            return P.when(db.TieringPolicy
                .find({
                    system: req.system.id,
                    deleted: null,
                })
                .exec());
        })
        .then(function(policies) {
            _.each(policies, function(p) {
                _.each(p.tiers, function(current_tier) {
                    if (_.findIndex(associated_tiers, function(a) {
                            return a === current_tier.tier.toString();
                        }) !== -1) {
                        associated_policies.push(p._id);
                    }
                });
            });
            return P.when(db.Bucket
                .find({
                    tiering: {
                        $in: associated_policies
                    },
                })
                .exec());
        })
        .then(function(res) {
            return _.map(res, function(r) {
                return r.name;
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
