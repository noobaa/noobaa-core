'use strict';

module.exports = {
    _init: _init,

    redirect: redirect,
    register_agent: register_agent,
    unregister_agent: unregister_agent,
    resync_agents: resync_agents,
    print_registered_agents: print_registered_agents,
    register_to_cluster: register_to_cluster,
    publish_to_cluster: publish_to_cluster,
};

var _ = require('lodash');
var util = require('util');
var fs = require('fs');
var P = require('../util/promise');
var server_rpc = require('../server/server_rpc');
var dbg = require('../util/debug_module')(__filename);
// dbg.set_level(5);

var agents_address_map = new Map();
var cluster_connections = new Set();

var CLUSTER_TOPOLOGY;
var CLUSTER_TOPOLOGY_FILE = '/etc/noobaa_cluster';

/*
 * Init
 */
function _init() {
    return P.nfcall(fs.stat, CLUSTER_TOPOLOGY_FILE)
        .then(function(exists) {
            return P.nfcall(fs.readFile, CLUSTER_TOPOLOGY_FILE);
        })
        .then(function(top) {
            CLUSTER_TOPOLOGY = JSON.parse(top);
        })
        .fail(function(err) {
            if (err.code !== 'ENOENT') {
                console.error('Topology file corrupted');
            }
        });
}

/*
 * REDIRECTOR API
 */
function redirect(req) {
    console.warn('NBNB:: got redirect', req.rpc_params);
    dbg.log2('redirect request for', req.rpc_params);

    //Remove the leading n2n:// prefix from the address
    var target_agent = req.rpc_params.target.slice(6);
    var address = agents_address_map.get(target_agent);
    if (address) {
        dbg.log3('redirect found entry', address);
        return P.when(server_rpc.client.node.redirect(req.rpc_params, {
            address: address,
        }));
    } else {
        //If part of a cluster, try to scattershot ther other redirectors
        if (CLUSTER_TOPOLOGY_FILE.servers) {
            //TODO:: Don't call myself
            return P.each(CLUSTER_TOPOLOGY_FILE.server, function(ser) {
                return P.when(server_rpc.bg_client.redirect(req.rpc_params, {
                    address: address,
                }));
            });
        }
        throw new Error('Agent not registered ' + target_agent);
    }
}

function register_agent(req) {
    dbg.log2('Registering agent', req.rpc_params.peer_id, 'with server', req.connection.url.href);

    var agent = req.rpc_params.peer_id;
    var address = agents_address_map.get(agent);
    if (address) {
        // Update data
        agents_address_map.set(agent, req.connection.url.href);
    } else {
        add_agent_to_connection(req.connection, agent);
    }
    return;
}

function unregister_agent(req) {
    dbg.log2('Un-registering agent', req.rpc_params.peer_id, 'with server', req.connection.url);

    var agent = req.rpc_params.peer_id;
    remove_agent_from_connection(req.connection, agent);
}

function resync_agents(req) {
    dbg.log0('resync_agents of #', req.rpc_params.agents.length,
        'agents with server', req.connection.url.href,
        'request timestamp', req.rpc_params.timestamp,
        'last_resync', req.connection.last_resync);

    if (req.connection.last_resync &&
        req.connection.last_resync >= req.rpc_params.timestamp) {
        dbg.warn('resync_agents recived old sync request, ignoring');
        return;
    }

    cleanup_on_close(req.connection);
    req.connection.last_resync = req.rpc_params.timestamp;
    _.each(req.rpc_params.agents, function(agent) {
        add_agent_to_connection(req.connection, agent);
    });
}

function print_registered_agents(req) {
    dbg.log0('Registered Agents:', util.inspect(agents_address_map, false, null));
    return agents_address_map.size + ' Registered Agents printed';
}

function cleanup_on_close(connection) {
    if (connection.agents) {
        dbg.log0('cleanup_on_close', connection.url.href,
            '#', connection.agents.size, 'agents');
        connection.agents.forEach(function(agent) {
            remove_agent_from_connection(connection, agent);
        });
        if (connection.agents.size) {
            dbg.warn('cleanup_on_close dangling agents in connection', connection.url.href,
                '#', connection.agents.size, 'agents');
        }
    }
}

function add_agent_to_connection(connection, agent) {
    agents_address_map.set(agent, connection.url.href);

    //Save agent on connection for quick cleanup on close,
    //Register on close handler to clean the agents form the agents2srvs map
    if (!connection.agents) {
        connection.agents = new Set();
        connection.on('close', function() {
            cleanup_on_close(connection);
        });
    }
    connection.agents.add(agent);
}

function remove_agent_from_connection(connection, agent) {
    var address = agents_address_map.get(agent);
    if (address) {
        if (connection.url.href === address) {
            //Remove agent
            agents_address_map.delete(agent);
        } else {
            dbg.warn('hmmm, recieved unregister for', agent, 'on connection to', connection.url.href,
                'while previously registered on', address, ', ignoring');
        }
    }
    if (!connection.agents || !connection.agents.delete(agent)) {
        dbg.warn('hmmm, recieved unregister for', agent, 'on connection to', connection.url.href,
            'while the agent was not registered on this connection');
    }
}


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
            address: address
        });
    }).return({});
}
