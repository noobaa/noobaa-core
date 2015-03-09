// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var mongoose = require('mongoose');
var rest_api = require('../util/rest_api');
var size_utils = require('../util/size_utils');
var api = require('../api');
var object_mapper = require('./object_mapper');
var node_monitor = require('./node_monitor');
var Semaphore = require('noobaa-util/semaphore');
var Agent = require('../agent/agent');
var db = require('./db');
var Barrier = require('../util/barrier');
var dbg = require('noobaa-util/debug_module')(__filename);
dbg.set_level(parseInt(process.env.LOG_LEVEL, 10) || 0);


/**
 *
 * NODE SERVER (REST)
 *
 */
module.exports = new api.node_api.Server({

    create_node: create_node,
    read_node: read_node,
    update_node: update_node,
    delete_node: delete_node,
    read_node_maps: read_node_maps,

    list_nodes: list_nodes,
    group_nodes: group_nodes,

    heartbeat: heartbeat,
});




/**
 *
 * CREATE_NODE
 *
 */
function create_node(req) {
    var info = _.pick(req.rest_params,
        'name',
        'is_server',
        'geolocation'
    );
    info.system = req.system.id;
    info.heartbeat = new Date(0);
    info.peer_id = db.new_object_id();
    info.storage = {
        alloc: req.rest_params.storage_alloc,
        used: 0,
    };

    // when the request role is admin it can provide any of the system tiers.
    // when the role was authorized only for create_node the athorization
    // must include the allowed tier.
    var tier_name = req.rest_params.tier;
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
                throw req.rest_error('tier not found', ['TIER SYSTEM MISMATCH', info]);
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
    var updates = _.pick(req.rest_params,
        'is_server',
        'geolocation',
        'srvmode'
    );
    if (req.rest_params.storage_alloc) {
        updates.storage = {
            alloc: req.rest_params.storage_alloc,
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
    if (req.rest_params.tier) throw req.rest_error('TODO switch tier');

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
            var params = _.pick(req.rest_params, 'skip', 'limit');
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
            var query = req.rest_params.query;
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
            var skip = req.rest_params.skip;
            var limit = req.rest_params.limit;
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
            var reduce_sum = size_utils.reduce_sum;
            var group_by = req.rest_params.group_by;
            var by_system = {
                system: req.system.id,
                deleted: null,
            };

            return db.Node.mapReduce({
                query: by_system,
                scope: {
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
                    var val = {
                        // count
                        c: 1,
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
                    var a = []; // allocated
                    var u = []; // used
                    values.forEach(function(v) {
                        c.push(v.c);
                        a.push(v.a);
                        u.push(v.u);
                    });
                    return {
                        c: reduce_sum(key, c),
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
    var node_id = req.rest_params.id;

    // verify the authorization to use this node for non admin roles
    if (req.role !== 'admin' && node_id !== req.auth.extra.node_id) {
        throw req.forbidden();
    }

    var params = _.pick(req.rest_params,
        'id',
        'geolocation',
        'ip',
        'port',
        'storage',
        'device_info');

    params.ip = params.ip ||
        req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress;

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

function find_node_by_block(req) {
    var match = req.rest_params.host.match(/http:\/\/([^:]+):([0-9]+)/);
    if (!match) {
        throw req.rest_error(400, 'invalid block host');
    }
    var ip = match[1];
    var port = match[2];
    return Q.when(
            db.Node.findOne({
                system: req.system.id,
                ip: ip,
                port: port,
                deleted: null,
            })
            .populate('tier', 'name')
            .exec())
        .then(db.check_not_deleted(req, 'node'));
}

function get_node_query(req) {
    return {
        system: req.system.id,
        name: req.rest_params.name,
        deleted: null,
    };
}
