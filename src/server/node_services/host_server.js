/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise.js');
const diag = require('../utils/server_diagnostics');
// const util = require('util');


// const pkg = require('../../../package.json');
// const dbg = require('../../util/debug_module')(__filename);
// const config = require('../../../config');
// const system_store = require('../system_services/system_store').get_instance();
const nodes_server = require('./node_server');
// const nodes_aggregator = require('./nodes_aggregator');
// const dbg = require('../../util/debug_module')(__filename);


function read_host(req) {
    return nodes_server.get_local_monitor().read_host(req.rpc_params.name);
}

function list_hosts(req) {
    const query = _prepare_hosts_query(req);
    const options = _.pick(req.rpc_params,
        'skip',
        'limit',
        'sort',
        'order',
        'recommended_hint',
        'adminfo');
    return nodes_server.get_local_monitor().list_hosts(query, options);
}

function migrate_hosts_to_pool(req) {
    return nodes_server.get_local_monitor().migrate_hosts_to_pool(req);
}

function get_test_hosts(req) {
    const list_res = nodes_server.get_local_monitor().list_hosts({
        system: String(req.system._id),
        mode: 'OPTIMAL'
    }, {
        limit: req.rpc_params.count,
        sort: 'shuffle'
    });
    return _.map(list_res.hosts,
        host => _.pick(host, 'host_id', 'rpc_address'));
}

function test_host_network() {
    throw new Error('NOT_IMPLEMENTED - use test_node_network');
}

function set_debug_host(req) {
    return nodes_server.get_local_monitor().set_debug_host(req);
}

function update_host_services(req) {
    const monitor = nodes_server.get_local_monitor();
    return monitor.update_nodes_services(req)
        .return();
}

function diagnose_host(req) {
    const { name } = req.rpc_params;
    const monitor = nodes_server.get_local_monitor();
    var out_path = `/public/host_${name.replace('#', '_')}_diagnostics.tgz`;
    var inner_path = `${process.cwd()}/build${out_path}`;

    return P.resolve()
        .then(() => diag.collect_server_diagnostics(req))
        .then(() => monitor.collect_host_diagnostics(name))
        .then(buffer => diag.write_agent_diag_file(buffer))
        .then(() => diag.pack_diagnostics(inner_path))
        .then(() => out_path);
    // TODO: Add activity event for this method.
}


/**
 * internal functions
 */



function _prepare_hosts_query(req) {
    const query = req.rpc_params.query || {};
    query.system = String(req.system._id);
    if (query.filter) {
        query.filter = new RegExp(_.escapeRegExp(query.filter), 'i');
    }
    if (query.hosts) {
        // extract the host sequence from host
        query.hosts = query.hosts.map(host => host.split('#')[1]);
    }
    if (query.pools) {
        query.pools = new Set(_.map(query.pools, pool_name => {
            const pool = req.system.pools_by_name[pool_name];
            return String(pool._id);
        }));
    }
    return query;
}


exports.read_host = read_host;
exports.get_test_hosts = get_test_hosts;
exports.test_host_network = test_host_network;
exports.set_debug_host = set_debug_host;
exports.update_host_services = update_host_services;
exports.list_hosts = list_hosts;
exports.migrate_hosts_to_pool = migrate_hosts_to_pool;
exports.diagnose_host = diagnose_host;
