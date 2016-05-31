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
    return monitor.list_nodes(
        req.system._id,
        req.rpc_params.query,
        req.rpc_params.skip,
        req.rpc_params.limit,
        req.rpc_params.pagination,
        req.rpc_params.sort,
        req.rpc_params.order,
        req);
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




// EXPORTS
exports._init = _init;
exports.ping = ping;
exports.list_nodes = list_nodes;
// exports.list_nodes_int = list_nodes_int; // TODO list_nodes_int
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
