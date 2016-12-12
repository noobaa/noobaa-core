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
const mongo_client = require('../../util/mongo_client');

// dbg.set_level(5);

const cluster_connections = new Set();
const alerts_connections = new Set();
const system_changes_connections = new Set();
let current_mongo_state = 'CONNECT';

mongo_client.instance().on('close', () => {
    current_mongo_state = 'DISCONNECT';
});
mongo_client.instance().on('reconnect', () => {
    current_mongo_state = 'CONNECT';
});


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

function register_for_system_changes(req) {
    var conn = req.connection;
    if (!system_changes_connections.has(conn)) {
        dbg.log0('register_for_system_changes', conn.url.href);
        system_changes_connections.add(conn);
        conn.on('close', function() {
            system_changes_connections.delete(conn);
        });
        return current_mongo_state;
    }
}

function register_for_alerts(req) {
    var conn = req.connection;
    if (!alerts_connections.has(conn)) {
        dbg.log0('register_for_alerts', conn.url.href);
        alerts_connections.add(conn);
        conn.on('close', function() {
            alerts_connections.delete(conn);
        });
    }
}

function unregister_from_alerts(req) {
    var conn = req.connection;
    if (!alerts_connections.has(conn)) {
        return;
    }
    alerts_connections.delete(conn);
}

function publish_alerts(req) {
    var connections = [];
    alerts_connections.forEach(function(conn) {
        connections.push(conn);
    });
    connections = _.uniq(connections);
    dbg.log3('publish_alerts:', req.rpc_params.request_params, connections);
    return P.map(connections, function(conn) {
            return server_rpc.client.frontend_notifications.alert(req.rpc_params.request_params, {
                connection: conn,
            });
        })
        .then(() => {
            dbg.log3('published');
        });
}

function publish_system_store_change(req) {
    var connections = [];
    system_changes_connections.forEach(function(conn) {
        connections.push(conn);
    });
    connections = _.uniq(connections);
    dbg.log3('publish_system_store_change:', req.rpc_params.event, connections);
    return P.map(connections, function(conn) {
            return server_rpc.client.frontend_notifications.notify_on_system_store({
                event: req.rpc_params.event
            }, {
                connection: conn,
            });
        })
        .then(() => {
            dbg.log3('published');
        });
}


// EXPORTS
exports.register_for_alerts = register_for_alerts;
exports.register_for_system_changes = register_for_system_changes;
exports.unregister_from_alerts = unregister_from_alerts;
exports.register_to_cluster = register_to_cluster;
exports.publish_to_cluster = publish_to_cluster;
exports.publish_alerts = publish_alerts;
exports.publish_system_store_change = publish_system_store_change;
