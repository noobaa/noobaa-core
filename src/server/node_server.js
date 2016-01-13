// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var size_utils = require('../util/size_utils');
var string_utils = require('../util/string_utils');
var object_mapper = require('./mapper/object_mapper');
var node_monitor = require('./node_monitor');
var db = require('./db');
var dbg = require('../util/debug_module')(__filename);

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
    list_nodes_int: list_nodes_int,
    group_nodes: group_nodes,
    max_node_capacity: max_node_capacity,

    heartbeat: node_monitor.heartbeat,
    redirect: node_monitor.redirect,
    n2n_signal: node_monitor.n2n_signal,
    self_test_to_node_via_web: node_monitor.self_test_to_node_via_web,
    collect_agent_diagnostics: node_monitor.collect_agent_diagnostics,
    set_debug_node: node_monitor.set_debug_node,
    test_latency_to_server: test_latency_to_server,
    get_test_nodes: get_test_nodes,
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
    info.system = req.system._id;
    info.heartbeat = new Date(0);
    info.peer_id = db.new_object_id();

    // storage info will be updated by heartbeat
    info.storage = {
        alloc: 0,
        used: 0,
        total: 0,
        free: 0,
    };

    // when the request role is admin it can provide any of the system tiers.
    // when the role was authorized only for create_node the athorization
    // must include the allowed tier.
    var tier_name = req.rpc_params.tier;
    if (req.role !== 'admin') {
        if (req.auth.extra.tier !== tier_name) throw req.forbidden();
    }
    var tier = req.system.tiers_by_name[tier_name];
    var pool = req.system.pools_by_name.default_pool;
    if (!tier || !pool) {
        throw req.rpc_error('NOT_FOUND', 'TIER/POOL NOT FOUND');
    }
    info.tier = tier._id;
    info.pool = pool._id;

    dbg.log0('CREATE NODE', info);
    return P.when(db.Node.create(info))
        .then(null, db.check_already_exists(req, 'node'))
        .then(function(node) {
            // create async
            db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'node.create',
                node: node,
            });
            var account_id = '';
            if (req.account) {
                account_id = req.account._id;
            }
            // a token for the agent authorized to use the new node id.
            var token = req.make_auth_token({
                account_id: account_id,
                system_id: req.system._id,
                role: 'agent',
                extra: {
                    node_id: node._id,
                    peer_id: node.peer_id,
                }
            });

            return {
                id: String(node._id),
                peer_id: String(node.peer_id),
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

    // to connect we remove the srvmode field
    if (updates.srvmode === 'connect') {
        delete updates.srvmode;
        updates.$unset = {
            srvmode: 1
        };
    }

    // TODO move node between tiers - requires decomission
    if (req.rpc_params.tier) throw req.rpc_error('INTERNAL', 'TODO switch tier');

    return P.when(db.Node
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
    return P.when(db.Node
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
    return list_nodes_int(
        req.system._id,
        req.rpc_params.query,
        req.rpc_params.skip,
        req.rpc_params.limit,
        req.rpc_params.pagination,
        req.rpc_params.sort,
        req.rpc_params.order,
        req);
}

/**
 *
 * LIST_NODES_INT
 *
 */
function list_nodes_int(system_id, query, skip, limit, pagination, sort, order, req) {
    var info;
    var sort_opt = {};
    return P.fcall(function() {
            info = {
                system: system_id,
                deleted: null,
            };
            query = query || {};
            if (query.name) {
                info.$or = [{
                    'name': new RegExp(query.name, 'i')
                }, {
                    'ip': new RegExp(string_utils.escapeRegExp(query.name), 'i')
                }];
            }
            if (query.geolocation) {
                info.geolocation = new RegExp(query.geolocation);
            }
            if (query.state) {
                var minimum_online_heartbeat = db.Node.get_minimum_online_heartbeat();
                switch (query.state) {
                    case 'online':
                        info.srvmode = null;
                        info.heartbeat = {
                            $gt: minimum_online_heartbeat
                        };
                        break;
                    case 'offline':
                        var offline_or_conditions = [{
                            srvmode: {
                                $exists: true
                            }
                        }, {
                            heartbeat: {
                                $lte: minimum_online_heartbeat
                            }
                        }];
                        // merge with previous $or condition
                        if (info.$or) {
                            info.$and = [{
                                $or: info.$or
                            }, {
                                $or: offline_or_conditions
                            }];
                            delete info.$or;
                        } else {
                            info.$or = offline_or_conditions;
                        }
                        break;
                }
            }

            if (sort) {
                var sort_order = (order === -1) ? -1 : 1;
                sort_opt[sort] = sort_order;
            }

            if (query.tier) {
                var tier = req.system.tiers_by_name[query.tier];
                info.tier = tier._id;
            }
            if (query.pool) { //Keep last in chain due to promise
                var pools_ids = _.map(query.pool, function(pool_name) {
                    var pool = req.system.pools_by_name[pool_name];
                    return pool._id;
                });
                info.pool = {
                    $in: pools_ids
                };
            }
            var find = db.Node.find(info)
                .sort(sort_opt)
                .populate('tier', 'name');
            if (skip) {
                find.skip(skip);
            }
            if (limit) {
                find.limit(limit);
            }
            return P.all([
                find.exec(),
                pagination && db.Node.count(info)
            ]);
        })
        .spread(function(nodes, total_count) {
            var res = {
                nodes: _.map(nodes, get_node_full_info)
            };
            if (pagination) {
                res.total_count = total_count;
            }
            return res;
        });
}



/**
 *
 * GROUP_NODES
 *
 */
function group_nodes(req) {
    return P.fcall(function() {
            var minimum_online_heartbeat = db.Node.get_minimum_online_heartbeat();
            var reduce_sum = size_utils.reduce_sum;
            var group_by = req.rpc_params.group_by;
            var by_system = {
                system: req.system._id,
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


function test_latency_to_server(req) {
    // nothing to do.
    // the caller is just testing round trip time to the server.
}

/*
 * MAX_NODE_CAPACITY
 * Return maximal node capacity according to given filter
 */
function max_node_capacity(req) {
    //TODO:: once filter is mplemented in list_nodes, also add it here for the query
    return P.when(db.Node
            .find({
                system: req.system._id,
                deleted: null,
            })
            .sort({
                'storage.total': 1
            })
            .limit(1))
        .then(function(max) {
            var max_capacity = 0;
            _.each(max[0].drives, function(d) {
                if (d.storage.total > max_capacity) {
                    max_capacity = d.storage.total;
                }
            });
            return max_capacity;
        });
}

/*
 * GET_RANDOM_TEST_NODES
 * return X random nodes for self test purposes
 */
function get_test_nodes(req) {
    var count = req.rpc_params.count;
    var minimum_online_heartbeat = db.Node.get_minimum_online_heartbeat();
    return P.when(db.Node
            .count({
                system: req.system._id,
                heartbeat: {
                    $gt: minimum_online_heartbeat
                },
                deleted: null,
            }))
        .then(function(total_nodes) {
            var rand_start = Math.floor(Math.random() *
                (total_nodes - count > 0 ? total_nodes - count : total_nodes));
            return P.when(db.Node
                .find({
                    system: req.system._id,
                    heartbeat: {
                        $gt: minimum_online_heartbeat
                    },
                    deleted: null,
                })
                .skip(rand_start)
                .limit(count));
        })
        .then(function(nodes) {
            var targets = _.map(nodes, function(n) {
                return 'n2n://' + n.peer_id;
            });
            return targets;
        });
}

// UTILS //////////////////////////////////////////////////////////



/*
function count_node_storage_used(node_id) {
    return P.when(db.DataBlock.mapReduce({
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
*/

var NODE_PICK_FIELDS = [
    'id',
    'name',
    'geolocation',
    'peer_id',
    'ip',
    'rpc_address',
    'base_address',
    'srvmode',
    'version',
    'latency_to_server',
    'latency_of_disk_read',
    'latency_of_disk_write',
    'debug_level',
];

var NODE_DEFAULT_FIELDS = {
    ip: '0.0.0.0',
    version: '',
    peer_id: '',
};

function get_node_full_info(node) {
    var info = _.defaults(_.pick(node, NODE_PICK_FIELDS), NODE_DEFAULT_FIELDS);
    if (node.srvmode) {
        info.srvmode = node.srvmode;
    }
    info.tier = node.tier.name;
    info.heartbeat = node.heartbeat.getTime();
    info.storage = get_storage_info(node.storage);
    info.drives = _.map(node.drives, function(drive) {
        return {
            mount: drive.mount,
            drive_id: drive.drive_id,
            storage: get_storage_info(drive.storage)
        };
    });
    info.online = db.Node.is_online(node);
    info.os_info = node.os_info && node.os_info.toObject() || {};
    if (info.os_info.uptime) {
        info.os_info.uptime = info.os_info.uptime.getTime();
    }
    return info;
}

function get_storage_info(storage) {
    //return _.omit(_.pick(storage, 'total', 'free', 'used', 'alloc', 'limit'), _.isUndefined);
    var DEFAULT_STORAGE = {
        total: 0,
        free: 0,
        used: 0,
        alloc: 0,
        limit: 0
    };
    return _.defaults(storage, DEFAULT_STORAGE);
}

function find_node_by_name(req) {
    return P.when(
            db.Node.findOne(get_node_query(req))
            .populate('tier', 'name')
            .exec())
        .then(db.check_not_deleted(req, 'node'));
}

function get_node_query(req) {
    return {
        system: req.system._id,
        name: req.rpc_params.name,
        deleted: null,
    };
}
