'use strict';

module.exports = {
    redirect: redirect,
    register_agent: register_agent,
    unregister_agent: unregister_agent,
    resync_agents: resync_agents,
};

var _ = require('lodash');
var P = require('../util/promise');
var server_rpc = require('./bg_workers_rpc').server_rpc;
var dbg = require('../util/debug_module')(__filename);

var REGISTERED_AGENTS = {
    agents2srvs: {},
};

/*
 * REDIRECTOR API
 */
function redirect(req) {
    dbg.log2('redirect request for', req.rpc_params);

    //Remove the leading n2n:// prefix from the address
    var target_agent = req.rpc_params.target.slice(6);
    var entry = REGISTERED_AGENTS.agents2srvs[target_agent];
    if (entry) {
        return P.when(server_rpc.client.node.redirect(req.rpc_params, {
                address: entry.server,
            }))
            .then(function(res) {
                return res;
            });
    } else {
        throw new Error('Agent not registered' + target_agent);
    }
}

function register_agent(req) {
    dbg.log2('Registering agent', req.rpc_params.peer_id, 'with server', req.connection.url);

    var agent = req.rpc_params.peer_id;
    var entry = REGISTERED_AGENTS.agents2srvs[agent];
    if (entry) {
        //Update data
        REGISTERED_AGENTS.agents2srvs[agent] = {
            server: req.connection.url,
        };
    } else {
        REGISTERED_AGENTS.agents2srvs[agent] = {
            server: req.connection.url,
        };

        //Save agent on connection for quick cleanup on close,
        //Register on close handler to clean the agents form the agents2srvs map
        if (!req.connection.agents) {
            req.connection.agents = [];
            req.connection.on('close', cleanup_on_close.bind(undefined, req.connection));
        }
        req.connection.agents.push(agent);
    }
    return;
}

function unregister_agent(req) {
    dbg.log2('Un-registering agent', req.rpc_params.peer_id, 'with server', req.connection.url);

    var agent = req.rpc_params.peer_id;
    var entry = REGISTERED_AGENTS.agents2srvs[agent];
    if (entry) {
        if (req.connection.url === entry.server) {
            //Remove agent
            delete REGISTERED_AGENTS.agents2srvs[agent];
        } else {
            dbg.log0('Error: recieved unregister for', agent, 'on connection to', req.connection.url,
                'while previously registered on', entry.server, ', ignoring');
        }
    }
    return;
}

function resync_agents(req) {
    dbg.log2('resync_agents of #', req.rpc_params.agents.length, 'agents with server', req.connection.url);
    if (req.connection.last_resync &&
        req.connection.last_resync < req.rpc_params.timestamp) {
        cleanup_on_close(req.connection);
        req.connection.last_resync = req.rpc_params.timestamp;
        _.each(req.rpc_params.agents, function(a) {
            REGISTERED_AGENTS.agents2srvs[a] = {
                server: req.connection.url,
            };
            req.connection.agents.push(a);
        });
    } else {
        dbg.log0('resync_agents recived old sync request, ignoring');
    }
}

function cleanup_on_close(connection) {
    _.each(connection.agents, function(agent) {
        delete REGISTERED_AGENTS.agents2srvs[agent];
    });
    connection.agents = null;
}
