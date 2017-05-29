/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
// const util = require('util');


// const pkg = require('../../../package.json');
// const dbg = require('../../util/debug_module')(__filename);
// const config = require('../../../config');
// const system_store = require('../system_services/system_store').get_instance();
const nodes_server = require('./node_server');
// const nodes_aggregator = require('./nodes_aggregator');
// const dbg = require('../../util/debug_module')(__filename);


function read_host(req) {
    return nodes_server.get_local_monitor().read_host(req.rpc_params.host_name);
}

function list_hosts(req) {
    const query = _prepare_hosts_query(req);
    const options = _.pick(req.rpc_params,
        'pagination',
        'skip',
        'limit',
        'sort',
        'order');
    return nodes_server.get_local_monitor().list_hosts(query, options);
}

function migrate_hosts_to_pool(req) {
    return nodes_server.get_local_monitor().migrate_hosts_to_pool(req);
}

function get_test_hosts() {
    throw new Error('NOT_IMPLEMENTED');
}

function test_host_network() {
    throw new Error('NOT_IMPLEMENTED');
}

function set_debug_host() {
    throw new Error('NOT_IMPLEMENTED');
}

function update_host_services(req) {
    let monitor = nodes_server.get_local_monitor();
    return monitor.update_nodes_services(req)
        .return();
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


exports.read_host = read_host;
exports.get_test_hosts = get_test_hosts;
exports.test_host_network = test_host_network;
exports.set_debug_host = set_debug_host;
exports.update_host_services = update_host_services;
exports.list_hosts = list_hosts;
exports.migrate_hosts_to_pool = migrate_hosts_to_pool;
