'use strict';

module.exports = {
    redirect: redirect,
    register_agent: register_agent,
    unregister_agent: unregister_agent,
    resync_agents: resync_agents,
    print_registered_agents: print_registered_agents,
};

var _ = require('lodash');
var util = require('util');
var P = require('../util/promise');
var bg_workers_rpc = require('./bg_workers_rpc').bg_workers_rpc;
var dbg = require('../util/debug_module')(__filename);

var REGISTERED_AGENTS = {
    agents2srvs: new Map(),
};

/*
 * REDIRECTOR API
 */
function redirect(req) {
    dbg.log2('redirect request for', req.rpc_params);

    //Remove the leading n2n:// prefix from the address
    var target_agent = req.rpc_params.target.slice(6);
    var entry = REGISTERED_AGENTS.agents2srvs.get(target_agent);
    if (entry) {
        dbg.log3('redirect found entry', entry);
        return P.when(bg_workers_rpc.client.node.redirect(req.rpc_params, {
            address: entry.server,
        }));
    } else {
        throw new Error('Agent not registered ' + target_agent);
    }
}

function register_agent(req) {
    dbg.log2('Registering agent', req.rpc_params.peer_id, 'with server', req.connection.url.href);

    var agent = req.rpc_params.peer_id;
    var entry = REGISTERED_AGENTS.agents2srvs.get(agent);
    if (entry) {
        // Update data
        REGISTERED_AGENTS.agents2srvs.set(agent, {
            server: req.connection.url.href,
        });
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
    dbg.log0('Registered Agents:', util.inspect(REGISTERED_AGENTS.agents2srvs, false, null));
    return REGISTERED_AGENTS.agents2srvs.size + ' Registered Agents printed';
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
    REGISTERED_AGENTS.agents2srvs.set(agent, {
        server: connection.url.href,
    });

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
    var entry = REGISTERED_AGENTS.agents2srvs.get(agent);
    if (entry) {
        if (connection.url.href === entry.server) {
            //Remove agent
            REGISTERED_AGENTS.agents2srvs.delete(agent);
        } else {
            dbg.warn('hmmm, recieved unregister for', agent, 'on connection to', connection.url.href,
                'while previously registered on', entry.server, ', ignoring');
        }
    }
    if (!connection.agents || !connection.agents.delete(agent)) {
        dbg.warn('hmmm, recieved unregister for', agent, 'on connection to', connection.url.href,
            'while the agent was not registered on this connection');
    }
}
