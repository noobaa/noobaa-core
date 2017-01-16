/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

// const P = require('../../util/promise');
// const pkg = require('../../../package.json');
// const dbg = require('../../util/debug_module')(__filename);
// const config = require('../../../config');
const string_utils = require('../../util/string_utils');
const system_store = require('../system_services/system_store').get_instance();
const nodes_monitor = require('./nodes_monitor');
const dbg = require('../../util/debug_module')(__filename);

let monitor;

// called on rpc server init
function _init() {
    monitor = new nodes_monitor.NodesMonitor();
    // start nodes_monitor if this is master, or this is not part of a rplica set
    if (system_store.is_cluster_master || !process.env.MONGO_RS_URL) {
        dbg.log0('this is master. starting nodes_monitor');
        return monitor.start();
    } else {
        dbg.log0('this is not master. nodes_monitor is not started');
    }
}

function get_local_monitor() {
    if (!monitor) throw new Error('NodesMonitor not running here');
    return monitor;
}

function stop_monitor() {
    return monitor.stop();
}

function start_monitor() {
    return monitor.start();
}

/**
 *
 * LIST_NODES
 *
 */
function list_nodes(req) {
    const query = _prepare_nodes_query(req);
    const options = _.pick(req.rpc_params,
        'pagination',
        'skip',
        'limit',
        'sort',
        'order');
    return monitor.list_nodes(query, options);
}

function aggregate_nodes(req) {
    const query = _prepare_nodes_query(req);
    const res = monitor.aggregate_nodes(query, req.rpc_params.group_by);
    // if (res.groups) {
    //     res.groups = _.map(res.groups, (group, group_key) => {
    //         if (req.rpc_params.group_by === 'pool') {
    //             const pool = system_store.data.get_by_id(group_key);
    //             group.name = pool.name;
    //         }
    //         return group;
    //     });
    // }
    return res;
}

function _prepare_nodes_query(req) {
    const query = req.rpc_params.query || {};
    query.system = String(req.system._id);
    if (query.filter) {
        query.filter = new RegExp(string_utils.escapeRegExp(query.filter), 'i');
    }
    if (query.geolocation) {
        query.geolocation = new RegExp(string_utils.escapeRegExp(query.geolocation), 'i');
    }
    if (query.pools) {
        query.pools = new Set(_.map(query.pools, pool_name => {
            const pool = req.system.pools_by_name[pool_name];
            return String(pool._id);
        }));
    }
    return query;
}


/*
 * GET_RANDOM_TEST_NODES
 * return X random nodes for self test purposes
 */
function get_test_nodes(req) {
    const list_res = monitor.list_nodes({
        system: String(req.system._id),
        online: true,
        decommissioning: false,
        decommissioned: false,
        deleting: false,
        deleted: false,
        skip_address: req.rpc_params.source,
        is_cloud_node: false,
    }, {
        pagination: true,
        limit: req.rpc_params.count,
        sort: 'shuffle'
    });
    return _.map(list_res.nodes,
        node => _.pick(node, 'name', 'rpc_address'));
}

function allocate_nodes(req) {
    const params = req.rpc_params;
    params.system = String(req.system._id);
    return monitor.allocate_nodes(params);
}

// UTILS //////////////////////////////////////////////////////////


// EXPORTS
exports._init = _init;
exports.get_local_monitor = get_local_monitor;
exports.stop_monitor = stop_monitor;
exports.start_monitor = start_monitor;
exports.test_node_id = req => monitor.test_node_id(req);
exports.heartbeat = req => monitor.heartbeat(req);
exports.read_node = req => monitor.read_node(req.rpc_params);
exports.decommission_node = req => monitor.decommission_node(req);
exports.recommission_node = req => monitor.recommission_node(req);
exports.delete_node = req => monitor.delete_node(req.rpc_params);
exports.list_nodes = list_nodes;
exports.aggregate_nodes = aggregate_nodes;
exports.get_test_nodes = get_test_nodes;
exports.allocate_nodes = allocate_nodes;
exports.migrate_nodes_to_pool = req => monitor.migrate_nodes_to_pool(req);
exports.n2n_signal = req => monitor.n2n_signal(req.rpc_params);
exports.n2n_proxy = req => monitor.n2n_proxy(req.rpc_params);
exports.test_node_network = req => monitor.test_node_network(req.rpc_params);
exports.set_debug_node = req => monitor.set_debug_node(req);
exports.collect_agent_diagnostics = req => monitor.collect_agent_diagnostics(req.rpc_params);
exports.report_error_on_node_blocks = req => monitor.report_error_on_node_blocks(req.rpc_params);
exports.sync_monitor_to_store = req => monitor.sync_to_store();
exports.ping = req => {};
