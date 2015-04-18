// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var mongoose = require('mongoose');
var size_utils = require('../util/size_utils');
var promise_utils = require('../util/promise_utils');
var api = require('../api');
var object_mapper = require('./object_mapper');
var node_monitor = require('./node_monitor');
var Semaphore = require('noobaa-util/semaphore');
var Agent = require('../agent/agent');
var db = require('./db');
var Barrier = require('../util/barrier');
var dbg = require('noobaa-util/debug_module')(__filename);
var config = require('../../config.js');

dbg.set_level(process.env.LOG_LEVEL ? parseInt(process.env.LOG_LEVEL, 10) : config.dbg_log_level);


/**
 *
 * NODE_SERVER
 *
 */
var node_server = {
    create_node: create_node,
    read_node: read_node,
    update_node: update_node,
    delete_node: delete_node,
    read_node_maps: read_node_maps,

    list_nodes: list_nodes,
    group_nodes: group_nodes,

    heartbeat: heartbeat,
};

module.exports = node_server;



/**
 *
 * CREATE_NODE
 *
 */
function create_node(req) {
    var info = _.pick(req.rpc_params,
        'name',
        'is_server',
        'geolocation'
    );
    info.system = req.system.id;
    info.heartbeat = new Date(0);
    info.peer_id = db.new_object_id();
    info.storage = {
        alloc: req.rpc_params.storage_alloc,
        used: 0,
    };

    // when the request role is admin it can provide any of the system tiers.
    // when the role was authorized only for create_node the athorization
    // must include the allowed tier.
    var tier_name = req.rpc_params.tier;
    if (req.role !== 'admin') {
        if (req.auth.extra.tier !== tier_name) throw req.forbidden();
    }

    return db.TierCache.get({
            system: req.system.id,
            name: tier_name,
        })
        .then(db.check_not_deleted(req, 'tier'))
        .then(function(tier) {
            info.tier = tier;

            if (String(tier.system) !== String(info.system)) {
                throw req.set_error('NOT_FOUND', null,
                    'TIER SYSTEM MISMATCH ' + info.name + ' ' + info.system);
            }

            return db.Node.create(info);
        })
        .then(null, db.check_already_exists(req, 'node'))
        .then(function(node) {

            // create async
            db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'node.create',
                node: node,
            });

            // a token for the agent authorized to use the new node id.
            var token = req.make_auth_token({
                account_id: req.account.id,
                system_id: req.system.id,
                role: 'agent',
                extra: {
                    node_id: node.id,
                    peer_id: node.peer_id,
                }
            });

            return {
                id: node.id,
                peer_id: node.peer_id,
                token: token
            };
        });
}



/**
 *
 * READ_NODE
 *
 */
function read_node(req) {
    return find_node_by_name(req)
        .then(function(node) {
            return get_node_full_info(node);
        });
}



/**
 *
 * UPDATE_NODE
 *
 */
function update_node(req) {
    var updates = _.pick(req.rpc_params,
        'is_server',
        'geolocation',
        'srvmode'
    );
    if (req.rpc_params.storage_alloc) {
        updates.storage = {
            alloc: req.rpc_params.storage_alloc,
        };
    }
    if (updates.srvmode === 'connect') {
        // to connect we remove the srvmode field
        delete updates.srvmode;
        updates.$unset = {
            srvmode: 1
        };
    }

    // TODO move node between tiers - requires decomission
    if (req.rpc_params.tier) throw req.set_error('INTERNAL', 'TODO switch tier');

    return Q.when(db.Node
            .findOneAndUpdate(get_node_query(req), updates)
            .exec())
        .then(db.check_not_deleted(req, 'node'))
        .thenResolve();
}



/**
 *
 * DELETE_NODE
 *
 */
function delete_node(req) {
    var updates = {
        deleted: new Date()
    };
    return Q.when(db.Node
            .findOneAndUpdate(get_node_query(req), updates)
            .exec())
        .then(db.check_not_found(req, 'node'))
        .then(function(node) {
            // TODO notify to initiate rebuild of blocks
        })
        .thenResolve();
}




/**
 *
 * READ_NODE_MAPS
 *
 */
function read_node_maps(req) {
    var node;
    return find_node_by_name(req)
        .then(function(node_arg) {
            node = node_arg;
            var params = _.pick(req.rpc_params, 'skip', 'limit');
            params.node = node;
            return object_mapper.read_node_mappings(params);
        })
        .then(function(objects) {
            return {
                node: get_node_full_info(node),
                objects: objects,
            };
        });
}



/**
 *
 * LIST_NODES
 *
 */
function list_nodes(req) {
    var info;
    return Q.fcall(function() {
            var query = req.rpc_params.query;
            info = {
                system: req.system.id,
                deleted: null,
            };
            if (!query) return;
            if (query.name) {
                info.name = new RegExp(query.name);
            }
            if (query.geolocation) {
                info.geolocation = new RegExp(query.geolocation);
            }
            if (query.tier) {
                return db.TierCache.get({
                        system: req.system.id,
                        name: query.tier,
                    })
                    .then(db.check_not_deleted(req, 'tier'))
                    .then(function(tier) {
                        info.tier = tier;
                    });
            }
        })
        .then(function() {
            var skip = req.rpc_params.skip;
            var limit = req.rpc_params.limit;
            var find = db.Node.find(info)
                .sort('-_id')
                .populate('tier', 'name');
            if (skip) {
                find.skip(skip);
            }
            if (limit) {
                find.limit(limit);
            }
            return find.exec();
        })
        .then(function(nodes) {
            return {
                nodes: _.map(nodes, get_node_full_info)
            };
        });
}



/**
 *
 * GROUP_NODES
 *
 */
function group_nodes(req) {
    return Q.fcall(function() {
            var minimum_online_heartbeat = db.Node.get_minimum_online_heartbeat();
            var reduce_sum = size_utils.reduce_sum;
            var group_by = req.rpc_params.group_by;
            var by_system = {
                system: req.system.id,
                deleted: null,
            };

            return db.Node.mapReduce({
                query: by_system,
                scope: {
                    // have to pass variables to map/reduce with a scope
                    minimum_online_heartbeat: minimum_online_heartbeat,
                    group_by: group_by,
                    reduce_sum: reduce_sum,
                },
                map: function() {
                    var key = {};
                    if (group_by.tier) {
                        key.t = this.tier;
                    }
                    if (group_by.geolocation) {
                        key.g = this.geolocation;
                    }
                    var online = (!this.srvmode && this.heartbeat >= minimum_online_heartbeat);
                    var val = {
                        // count
                        c: 1,
                        // online
                        o: online ? 1 : 0,
                        // allocated
                        a: this.storage.alloc || 0,
                        // used
                        u: this.storage.used || 0,
                    };
                    /* global emit */
                    emit(key, val);
                },
                reduce: function(key, values) {
                    var c = []; // count
                    var o = []; // online
                    var a = []; // allocated
                    var u = []; // used
                    values.forEach(function(v) {
                        c.push(v.c);
                        o.push(v.o);
                        a.push(v.a);
                        u.push(v.u);
                    });
                    return {
                        c: reduce_sum(key, c),
                        o: reduce_sum(key, o),
                        a: reduce_sum(key, a),
                        u: reduce_sum(key, u),
                    };
                }
            });
        })
        .then(function(res) {
            console.log('GROUP NODES', res);
            return {
                groups: _.map(res, function(r) {
                    var group = {
                        count: r.value.c,
                        online: r.value.o,
                        storage: {
                            alloc: r.value.a,
                            used: r.value.u,
                        }
                    };
                    if (r._id.t) {
                        group.tier = r._id.t;
                    }
                    if (r._id.g) {
                        group.geolocation = r._id.g;
                    }
                    return group;
                })
            };
        });
}




/**
 *
 * HEARTBEAT
 *
 */
function heartbeat(req) {
    var node_id = req.rpc_params.id;

    // verify the authorization to use this node for non admin roles
    if (req.role !== 'admin' && node_id !== req.auth.extra.node_id) {
        throw req.forbidden();
    }

    var params = _.pick(req.rpc_params,
        'id',
        'geolocation',
        'ip',
        'port',
        'storage',
        'device_info');

    params.ip = params.ip ||
        (req.headers && req.headers['x-forwarded-for']) ||
        (req.connection && req.connection.remoteAddress);
    params.port = params.port || 0;

    params.system = req.system;

    return node_monitor.heartbeat(params);
}





// UTILS //////////////////////////////////////////////////////////



function count_node_storage_used(node_id) {
    return Q.when(db.DataBlock.mapReduce({
            query: {
                node: node_id,
                deleted: null,
            },
            map: function() {
                emit('size', this.size);
            },
            reduce: size_utils.reduce_sum
        }))
        .then(function(res) {
            return res && res[0] && res[0].value || 0;
        });
}


function get_node_full_info(node) {
    var info = _.pick(node, 'id', 'name', 'geolocation', 'srvmode');
    if (!info.srvmode) delete info.srvmode;
    info.tier = node.tier.name;
    info.peer_id = node.peer_id || '';
    info.ip = node.ip || '0.0.0.0';
    info.port = node.port || 0;
    info.heartbeat = node.heartbeat.getTime();
    info.storage = {
        alloc: node.storage.alloc || 0,
        used: node.storage.used || 0,
    };
    info.online = node.is_online();
    info.device_info = node.device_info || {};
    return info;
}

function find_node_by_name(req) {
    return Q.when(
            db.Node.findOne(get_node_query(req))
            .populate('tier', 'name')
            .exec())
        .then(db.check_not_deleted(req, 'node'));
}

function get_node_query(req) {
    return {
        system: req.system.id,
        name: req.rpc_params.name,
        deleted: null,
    };
}
