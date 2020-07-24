/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

// const P = require('../../util/promise');
// const pkg = require('../../../package.json');
// const dbg = require('../../util/debug_module')(__filename);
// const config = require('../../../config');
const system_store = require('../system_services/system_store').get_instance();
const nodes_monitor = require('./nodes_monitor');
const nodes_aggregator = require('./nodes_aggregator');
const dbg = require('../../util/debug_module')(__filename);

let monitor;
let original_monitor;

// called on rpc server init
function _init() {
    original_monitor = new nodes_monitor.NodesMonitor();
    monitor = original_monitor;
    // start nodes_monitor if this is master, or this is not part of a rplica set
    if (!system_store.is_cluster_master && process.env.MONGO_RS_URL) {
        dbg.log0('this is not master. nodes_monitor is not started');
    } else if (process.env.CORETEST) {
        dbg.log0('nodes_monitor will start manually by coretest');
    } else {
        dbg.log0('this is master. starting nodes_monitor');
        return monitor.start();
    }
}

function get_local_monitor() {
    if (!monitor) throw new Error('NodesMonitor not running here');
    return monitor;
}

function set_external_monitor(external_monitor) {
    monitor = external_monitor;
    return monitor;
}

function reset_original_monitor() {
    monitor = original_monitor;
    return monitor;
}

function stop_monitor(force_close_n2n) {
    return monitor.stop(force_close_n2n);
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

async function aggregate_nodes(req) {
    const query = _prepare_nodes_query(req);
    const res = req.rpc_params.aggregate_hosts ?
        monitor.aggregate_hosts(query, req.rpc_params.group_by) :
        monitor.aggregate_nodes(query, req.rpc_params.group_by, await monitor.get_nodes_stats(req.system._id));
    return res;
}

function _prepare_nodes_query(req) {
    const query = req.rpc_params.query || {};
    query.system = String(req.system._id);
    if (query.filter) {
        query.filter = new RegExp(_.escapeRegExp(query.filter), 'i');
    }
    if (query.geolocation) {
        query.geolocation = new RegExp(_.escapeRegExp(query.geolocation), 'i');
    }
    if (query.pools) {
        query.pools = new Set(_.map(query.pools, pool_name => {
            const pool = req.system.pools_by_name[pool_name];
            return String(pool._id);
        }));
    }
    return query;
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
exports.set_external_monitor = set_external_monitor;
exports.reset_original_monitor = reset_original_monitor;
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
exports.get_test_nodes = req => monitor.get_test_nodes(req);
exports.allocate_nodes = allocate_nodes;
exports.get_nodes_stats_by_cloud_service = req => monitor.get_nodes_stats_by_cloud_service(req);
exports.get_node_ids = req => monitor.get_node_ids(req);
exports.aggregate_data_free_by_tier = req => nodes_aggregator.aggregate_data_free_by_tier(req);
exports.n2n_signal = req => monitor.n2n_signal(req.rpc_params);
exports.n2n_proxy = req => monitor.n2n_proxy(req.rpc_params);
exports.test_node_network = req => monitor.test_node_network(req);
exports.set_debug_node = req => monitor.set_debug_node(req);
exports.collect_agent_diagnostics = req => monitor.collect_agent_diagnostics(req.rpc_params);
exports.report_error_on_node_blocks = req => monitor.report_error_on_node_blocks(req.rpc_params);
exports.sync_monitor_to_store = req => monitor.sync_to_store();
exports.sync_monitor_storage_info = req => monitor.sync_storage_to_store();
exports.ping = req => { /*Empty Func*/ };
