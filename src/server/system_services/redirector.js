/**
 *
 * REDIRECTOR
 *
 */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const server_rpc = require('../server_rpc');
const system_store = require('../system_services/system_store').get_instance();


// dbg.set_level(5);

const cluster_connections = new Set();
const system_events_connections = new Set();

system_store.listen_for_changes();


function register_to_cluster(req) {
    var conn = req.connection;
    if (!cluster_connections.has(conn)) {
        dbg.log0('register_to_cluster', conn.url.href);
        cluster_connections.add(conn);
        conn.on('close', function() {
            cluster_connections.delete(conn);
        });
    }
}

function publish_to_cluster(req) {
    var api_name = req.rpc_params.method_api.slice(0, -4); // remove _api suffix
    var method = req.rpc_params.method_name;
    var addresses = ['fcall://fcall']; // also call on myself
    cluster_connections.forEach(function(conn) {
        addresses.push(conn.url.href);
    });
    addresses = _.uniq(addresses);
    dbg.log0('publish_to_cluster:', addresses);
    return P.map(addresses, function(address) {
            return server_rpc.client[api_name][method](req.rpc_params.request_params, {
                address: address,
                auth_token: req.auth_token,
            });
        })
        .then(function(res) {
            return {
                redirect_reply: {
                    aggregated: res,
                }
            };
        });
}

function register_for_system_events(req) {
    var conn = req.connection;
    if (!system_events_connections.has(conn)) {
        dbg.log0('register_for_system_events', conn.url.href);
        system_events_connections.add(conn);
        conn.on('close', function() {
            system_events_connections.delete(conn);
        });
    }
}


function unregister_from_system_events(req) {
    var conn = req.connection;
    if (!system_events_connections.has(conn)) {
        return;
    }
    dbg.log0('unregister_for_system_events', conn.url.href);
    system_events_connections.delete(conn);
}


function publish_alerts(req) {
    var connections = [];
    system_events_connections.forEach(function(conn) {
        connections.push(conn);
    });
    dbg.log3('publish_alerts:', req.rpc_params.request_params, connections);
    return P.map(connections, function(conn) {
            return server_rpc.client.frontend_notifications.emit_event({
                event: 'ALERT',
                args: req.rpc_params.request_params
            }, {
                connection: conn,
            });
        })
        .then(() => {
            dbg.log3('published');
        });
}

function publish_system_store_change(req) {
    var connections = [];
    system_events_connections.forEach(function(conn) {
        connections.push(conn);
    });
    dbg.log3('publish_system_store_change:', req.rpc_params.event, connections);
    return P.map(connections, function(conn) {
            return server_rpc.client.frontend_notifications.emit_event({
                event: req.rpc_params.event
            }, {
                connection: conn,
            });
        })
        .then(() => {
            dbg.log3('published');
        });
}


function publish_current_state(req) {
    var connections = [];
    system_events_connections.forEach(function(conn) {
        connections.push(conn);
    });
    dbg.log3('publish_current_state:', req.rpc_params.request_params, connections);
    return P.map(connections, function(conn) {
            return server_rpc.client.frontend_notifications.emit_event({
                event: system_store.get_current_state()
            }, {
                connection: conn,
            });
        })
        .then(() => {
            dbg.log3('published');
        });
}


// EXPORTS
exports.register_for_system_events = register_for_system_events;
exports.unregister_from_system_events = unregister_from_system_events;
exports.publish_current_state = publish_current_state;
exports.register_to_cluster = register_to_cluster;
exports.publish_to_cluster = publish_to_cluster;
exports.publish_alerts = publish_alerts;
exports.publish_system_store_change = publish_system_store_change;
