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

// dbg.set_level(5);

const cluster_connections = new Set();
const alerts_connections = new Set();

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


// EXPORTS
exports.register_for_alerts = register_for_alerts;
exports.register_to_cluster = register_to_cluster;
exports.publish_to_cluster = publish_to_cluster;
exports.publish_alerts = publish_alerts;
