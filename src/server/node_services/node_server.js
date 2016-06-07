/**
 *
 * NODE SERVER
 *
 */
'use strict';

const _ = require('lodash');

// const P = require('../../util/promise');
// const pkg = require('../../../package.json');
// const dbg = require('../../util/debug_module')(__filename);
// const config = require('../../../config');
// const ActivityLog = require('../analytic_services/activity_log');
// const nodes_store = require('./nodes_store').get_instance();
const string_utils = require('../../util/string_utils');
const nodes_monitor = require('./nodes_monitor');

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
    const options = _.pick(req.rpc_params,
        'pagination',
        'skip',
        'limit',
        'sort',
        'order');
    return monitor.list_nodes(query, options);
}



/*
 * GET_RANDOM_TEST_NODES
 * return X random nodes for self test purposes
 */
function get_test_nodes(req) {
    const list_res = monitor.list_nodes({
        system: String(req.system._id),
        state: 'online',
        skip_address: req.rpc_params.source
    }, {
        pagination: true,
        limit: req.rpc_params.count,
        sort: 'shuffle'
    });
    return _.map(list_res.nodes,
        node => _.pick(node, 'name', 'rpc_address'));
}

// UTILS //////////////////////////////////////////////////////////




// EXPORTS
exports.monitor = monitor;
exports._init = _init;
exports.ping = ping;
exports.list_nodes = list_nodes;
exports.get_test_nodes = get_test_nodes;
exports.sync_monitor_to_store = req => monitor.sync_to_store();
exports.heartbeat = req => monitor.heartbeat(req);
exports.read_node = req => monitor.read_node_by_name(req.rpc_params.name);
exports.n2n_signal = req => monitor.n2n_signal(req);
exports.n2n_proxy = req => monitor.n2n_proxy(req);
exports.test_node_network = req => monitor.test_node_network(req);
exports.set_debug_node = req => monitor.set_debug_node(req);
exports.collect_agent_diagnostics = req => monitor.collect_agent_diagnostics(req);
exports.report_node_block_error = req =>
    monitor.report_node_block_error(req.rpc_params.block_md.address, req);
exports.delete_node = req => monitor.delete_node_by_name(req.rpc_params.name);
