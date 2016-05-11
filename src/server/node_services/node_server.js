/**
 *
 * NODE_SERVER
 *
 */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const ActivityLog = require('../analytic_services/activity_log');
const nodes_store = require('./nodes_store');
const node_monitor = require('./node_monitor');
const string_utils = require('../../util/string_utils');


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
    node.peer_id = nodes_store.make_node_id();

    // storage info will be updated by heartbeat
    node.storage = {
        alloc: 0,
        used: 0,
        total: 0,
        free: 0,
    };

    var pool = {};
    if (req.rpc_params.cloud_pool_name) {
        pool = req.system.pools_by_name[req.rpc_params.cloud_pool_name];
        dbg.log0('creating node in cloud pool', req.rpc_params.cloud_pool_name, pool);
    } else {
        pool = req.system.pools_by_name.default_pool;
    }

    if (!pool) {
        throw req.rpc_error('NO_DEFAULT_POOL', 'No default pool');
    }
    node.pool = pool._id;

    dbg.log0('CREATE NODE', node);
    return nodes_store.create_node(req, node)
        .then(function(created_node) {
            // create async
            ActivityLog.create({
                system: req.system,
                level: 'info',
                event: 'node.create',
                node: created_node._id,
                actor: req.account && req.account._id,
                desc: `${created_node.name} was added by ${req.account && req.account.email}`,
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
                    node_id: created_node._id,
                    peer_id: created_node.peer_id,
                }
            });

            return {
                id: String(created_node._id),
                peer_id: String(created_node.peer_id),
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
    var minimum_online_heartbeat = nodes_store.get_minimum_online_heartbeat();
    var offline_or_conditions = [{
        srvmode: {
            $exists: true
        }
    }, {
        heartbeat: {
            $lte: minimum_online_heartbeat
        }
    }];
    return P.fcall(function() {
            info = {
                system: system_id,
                deleted: null,
            };
            query = query || {};
            if (query.name) {
                info.$or = [{
                    name: new RegExp(query.name, 'i')
                }, {
                    ip: new RegExp(string_utils.escapeRegExp(query.name), 'i')
                }];
            }
            if (query.geolocation) {
                info.geolocation = new RegExp(query.geolocation);
            }
            if (query.accessibility) {
                switch (query.accessibility) {
                    case 'FULL_ACCESS':
                        info.srvmode = null;
                        info.heartbeat = {
                            $gt: minimum_online_heartbeat
                        };
                        info['storage.free'] = {
                            $gt: config.NODES_FREE_SPACE_RESERVE
                        };
                        break;
                    case 'READ_ONLY':
                        info.srvmode = null;
                        info.heartbeat = {
                            $gt: minimum_online_heartbeat
                        };
                        info['storage.free'] = {
                            $lt: config.NODES_FREE_SPACE_RESERVE
                        };
                        break;
                    case 'NO_ACCESS':
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
                    default:
                        break;
                }
            }
            //mock up - TODO: replace with real state.
            if (query.filter) {
                info.$or = [{
                    name: new RegExp(query.filter, 'i')
                }, {
                    ip: new RegExp(string_utils.escapeRegExp(query.filter), 'i')
                }];
            }
            //mock up - TODO: replace with real state.
            if (query.trust_level) {
                switch (query.trust_level) {
                    case 'TRUSTED':
                        info.geolocation = 'Ireland';
                        break;
                    case 'UNTRUSTED':
                        info.geolocation = {
                            $ne: 'Ireland'
                        };
                        break;
                    default:
                        break;
                }
            }
            //mock up - TODO: replace with real state.
            if (query.data_activity) {
                switch (query.data_activity) {
                    case 'EVACUATING':
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
                    case 'REBUILDING':
                        info.srvmode = null;
                        info.heartbeat = {
                            $gt: minimum_online_heartbeat
                        };
                        info['storage.free'] = {
                            $gt: config.NODES_FREE_SPACE_RESERVE
                        };
                        break;
                    case 'MIGRATING':
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
                    default:
                        break;
                }
            }
            if (query.state) {
                switch (query.state) {
                    case 'online':
                        info.srvmode = null;
                        info.heartbeat = {
                            $gt: minimum_online_heartbeat
                        };
                        break;
                    case 'offline':
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
                    default:
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
            dbg.log0("ETET nodes", info);
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
    var source = req.rpc_params.source;
    var minimum_online_heartbeat = nodes_store.get_minimum_online_heartbeat();
    return nodes_store.count_nodes({
            system: req.system._id,
            heartbeat: {
                $gt: minimum_online_heartbeat
            },
            rpc_address: {
                $ne: source
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
                rpc_address: {
                    $ne: source
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
        .then(test_nodes => {
            return nodes_store.find_nodes({
                    system: req.system._id,
                    rpc_address: {
                        $eq: source
                    },
                    deleted: null,
                }, {
                    fields: {
                        _id: 0,
                        name: 1,
                    },
                    limit: 1
                })
                .then(res_node => {
                    ActivityLog.create({
                        system: req.system._id,
                        actor: req.account && req.account._id,
                        level: 'info',
                        event: 'node.test_node',
                        node: res_node._id,
                        desc: `${res_node && res_node[0].name} was tested by ${req.account && req.account.email}`,
                    });
                    return test_nodes;
                });
        });
}

// UTILS //////////////////////////////////////////////////////////


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
    if (node.storage.free <= config.NODES_FREE_SPACE_RESERVE && !(node.storage.limit && node.storage.free > 0)) {
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


// EXPORTS
exports.create_node = create_node;
exports.read_node = read_node;
exports.update_node = update_node;
exports.delete_node = delete_node;
exports.list_nodes = list_nodes;
exports.list_nodes_int = list_nodes_int;
exports.max_node_capacity = max_node_capacity;
exports.heartbeat = node_monitor.heartbeat;
exports.redirect = node_monitor.redirect;
exports.n2n_signal = node_monitor.n2n_signal;
exports.self_test_to_node_via_web = node_monitor.self_test_to_node_via_web;
exports.collect_agent_diagnostics = node_monitor.collect_agent_diagnostics;
exports.set_debug_node = node_monitor.set_debug_node;
exports.report_node_block_error = node_monitor.report_node_block_error;
exports.test_latency_to_server = test_latency_to_server;
exports.get_test_nodes = get_test_nodes;
