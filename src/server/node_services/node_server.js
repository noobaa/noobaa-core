/**
 *
 * NODE SERVER
 *
 */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
// const pkg = require('../../../package.json');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const ActivityLog = require('../analytic_services/activity_log');
const nodes_store = require('./nodes_store');
const string_utils = require('../../util/string_utils');
const nodes_monitor = require('./node_monitor');

const monitor = new nodes_monitor.NodesMonitor();


function _init() {
    return monitor.start();
}


function ping(req) {
    // nothing to do - the caller is just testing it can reach the server.
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
    if (node.storage.free <= config.NODES_FREE_SPACE_RESERVE &&
        !(node.storage.limit && node.storage.free > 0)) {
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
exports._init = _init;
exports.ping = ping;
exports.list_nodes = list_nodes;
exports.list_nodes_int = list_nodes_int;
exports.get_test_nodes = get_test_nodes;
exports.heartbeat = req => monitor.heartbeat(req);
exports.read_node = req => monitor.read_node_by_name(req.rpc_params.name);
exports.delete_node = req => monitor.delete_node_by_name(req.rpc_params.name);
exports.redirect = req => monitor.redirect(req);
exports.n2n_signal = req => monitor.n2n_signal(req);
exports.test_node_network = req => monitor.test_node_network(req);
exports.set_debug_node = req => monitor.set_debug_node(req);
exports.collect_agent_diagnostics = req =>
    monitor.collect_agent_diagnostics(req.rpc_params.name);
exports.report_node_block_error = req =>
    monitor.report_node_block_error(req.rpc_params.block_md.address, req);
