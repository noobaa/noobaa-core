// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var size_utils = require('../util/size_utils');
var string_utils = require('../util/string_utils');
var mongo_functions = require('../util/mongo_functions');
var map_reader = require('./mapper/map_reader');
var node_monitor = require('./node_monitor');
var nodes_store = require('./stores/nodes_store');
var config = require('../../config');
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
    var node = _.pick(req.rpc_params,
        'name',
        'is_server',
        'geolocation'
    );
    node.system = req.system._id;
    node.heartbeat = new Date(0);
    node.peer_id = db.new_object_id();

    // storage info will be updated by heartbeat
    node.storage = {
        alloc: 0,
        used: 0,
        total: 0,
        free: 0,
    };

    var pool = req.system.pools_by_name.default_pool;
    if (!pool) {
        throw req.rpc_error('NOT_FOUND', 'DEFAULT POOL NOT FOUND');
    }
    node.pool = pool._id;

    dbg.log0('CREATE NODE', node);
    return nodes_store.create_node(req, node)
        .then(function(node) {
            // create async
            db.ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'node.create',
                node: node._id,
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
    return nodes_store.find_node_by_name(req).then(get_node_full_info);
}



/**
 *
 * UPDATE_NODE
 *
 */
function update_node(req) {
    var updates = {
        $set: _.pick(req.rpc_params,
            'is_server',
            'geolocation',
            'srvmode'
        )
    };

    // to connect we remove the srvmode field
    if (updates.$set.srvmode === 'connect') {
        delete updates.$set.srvmode;
        updates.$unset = {
            srvmode: 1
        };
    }

    return nodes_store.find_node_by_name(req)
        .then(node => nodes_store.update_node_by_name(req, updates))
        .return();
}



/**
 *
 * DELETE_NODE
 *
 */
function delete_node(req) {
    // TODO notify to initiate rebuild of blocks
    return nodes_store.find_node_by_name(req)
        .then(node => nodes_store.delete_node_by_name(req))
        .return();
}




/**
 *
 * READ_NODE_MAPS
 *
 */
function read_node_maps(req) {
    var node;
    return nodes_store.find_node_by_name(req)
        .then(node_arg => {
            node = node_arg;
            var params = _.pick(req.rpc_params, 'skip', 'limit');
            params.node = node;
            return map_reader.read_node_mappings(params);
        })
        .then(objects => ({
            node: get_node_full_info(node),
            objects: objects,
        }));
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
                var minimum_online_heartbeat = nodes_store.get_minimum_online_heartbeat();
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

            if (query.pools) { //Keep last in chain due to promise
                var pools_ids = _.map(query.pools, function(pool_name) {
                    var pool = req.system.pools_by_name[pool_name];
                    return pool._id;
                });
                info.pool = {
                    $in: pools_ids
                };
            }
            return P.join(
                nodes_store.find_nodes(info, {
                    sort: sort_opt,
                    limit: limit,
                    skip: skip
                }),
                pagination && nodes_store.count_nodes(info));
        })
        .spread(function(nodes, total_count) {
            console.log('list_nodes', nodes.length, '/', total_count);
            var res = {
                nodes: _.map(nodes, node => {
                    nodes_store.resolve_node_object_ids(node);
                    return get_node_full_info(node);
                })
            };
            if (pagination) {
                res.total_count = total_count;
            }
            return res;
        });
}



/**
 *
 * TODO REMOVE GROUP_NODES API. UNUSED IN NEW UI
 *
 */
function group_nodes(req) {
    return P.fcall(function() {
            var minimum_online_heartbeat = nodes_store.get_minimum_online_heartbeat();
            var reduce_sum = size_utils.reduce_sum;
            var group_by = req.rpc_params.group_by;
            var by_system = {
                system: req.system._id,
                deleted: null,
            };

            let NodeModel = require('./stores/node_model');
            return NodeModel.mapReduce({
                query: by_system,
                scope: {
                    // have to pass variables to map/reduce with a scope
                    minimum_online_heartbeat: minimum_online_heartbeat,
                    group_by: group_by,
                    reduce_sum: reduce_sum,
                },
                map: mongo_functions.map_nodes_groups,
                reduce: mongo_functions.reduce_nodes_groups
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
                    if (r._id.p) {
                        group.pool = String(r._id.p);
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
    return nodes_store.find_nodes({
            system: req.system._id,
            deleted: null,
        }, {
            sort: {
                'storage.total': 1
            },
            limit: 1
        })
        .then(nodes => {
            return nodes && nodes[0] && nodes[0].storage.total || 0;
        });
}

/*
 * GET_RANDOM_TEST_NODES
 * return X random nodes for self test purposes
 */
function get_test_nodes(req) {
    var count = req.rpc_params.count;
    var minimum_online_heartbeat = nodes_store.get_minimum_online_heartbeat();
    return nodes_store.count_nodes({
            system: req.system._id,
            heartbeat: {
                $gt: minimum_online_heartbeat
            },
            deleted: null,
        })
        .then(nodes_count => {
            var rand_start = Math.floor(Math.random() *
                (nodes_count - count > 0 ? nodes_count - count : 0));
            return nodes_store.find_nodes({
                system: req.system._id,
                heartbeat: {
                    $gt: minimum_online_heartbeat
                },
                deleted: null,
            }, {
                fields: {
                    _id: 0,
                    name: 1,
                    rpc_address: 1
                },
                skip: rand_start,
                limit: count
            });
        })
        .then((res) => {
            db.ActivityLog.create({
                system: req.system._id,
                actor: req.account && req.account._id,
                level: 'info',
                event: 'node.test_node'
            });
            return res;
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
            map: mongo_functions.map_size,
            reduce: mongo_functions.reduce_sum
        }))
        .then(function(res) {
            return res && res[0] && res[0].value || 0;
        });
}
*/

const NODE_INFO_PICK_FIELDS = [
    'name',
    'geolocation',
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
const NODE_INFO_DEFAULT_FIELDS = {
    ip: '0.0.0.0',
    version: '',
    peer_id: '',
    rpc_address: '',
    base_address: '',
};

function get_node_full_info(node) {
    var info = _.defaults(_.pick(node, NODE_INFO_PICK_FIELDS), NODE_INFO_DEFAULT_FIELDS);
    info.id = String(node._id);
    info.peer_id = String(node.peer_id);
    if (node.srvmode) {
        info.srvmode = node.srvmode;
    }
    if (node.storage.free <= config.NODES_FREE_SPACE_RESERVE) {
        info.storage_full = true;
    }
    info.pool = node.pool.name;
    info.heartbeat = node.heartbeat.getTime();
    info.storage = get_storage_info(node.storage);
    info.drives = _.map(node.drives, function(drive) {
        return {
            mount: drive.mount,
            drive_id: drive.drive_id,
            storage: get_storage_info(drive.storage)
        };
    });
    info.online = nodes_store.is_online_node(node);
    info.os_info = _.defaults({}, node.os_info);
    if (info.os_info.uptime) {
        info.os_info.uptime = new Date(info.os_info.uptime).getTime();
    }
    if (info.os_info.last_update) {
        info.os_info.last_update = new Date(info.os_info.last_update).getTime();
    }
    return info;
}

function get_storage_info(storage) {
    return {
        total: storage.total || 0,
        free: storage.free || 0,
        used: storage.used || 0,
        alloc: storage.alloc || 0,
        limit: storage.limit || 0
    };
}
