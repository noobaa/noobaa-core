'use strict';

module.exports = {
    redirect: redirect,
    register_agent: register_agent,
    unregister_agent: unregister_agent,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    unsubscribe_all: unsubscribe_all,
};

var _ = require('lodash');
var P = require('../util/promise');
var server_rpc = require('./bg_workers_rpc').server_rpc;
var dbg = require('../util/debug_module')(__filename);

var REGISTERED_AGENTS = {
    agents2srvs: {},
};

/*
 * SIGNALLER API
 */
function redirect(req) {
    dbg.log2('redirect request for', req.rpc_params);

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
    dbg.log2('Registering agent', req.rpc_params.agent, 'with server', req.rpc_params.server);

    var agent = req.rpc_params.agent;
    var entry = REGISTERED_AGENTS.agents2srvs[agent];
    if (entry) {
        //Update data
        var reg = entry.registrations;
        REGISTERED_AGENTS.agents2srvs[agent] = {
            server: req.rpc_params.server,
            registrations: reg
        };

        //Go over subscribers list and notify them on change
        dbg.log0('Notifying', reg, 'on agent change');
        _.each(reg, function(r) {
            notify_change(r);
        });
    } else {
        REGISTERED_AGENTS.agents2srvs[agent] = {
            server: req.rpc_params.server,
            registrations: {}
        };

        //Save agent on connection for quick cleanup on close,
        //Register on close handler to clean the agents form the agents2srvs map
        if (!_.has(req.connection, 'agents')) {
            req.connection.agents = [];
            req.connection.on('close', cleanup_on_close.bind(undefined, req.connection));
        }
        req.connection.agents.push(agent);
    }
    return;
}

function unregister_agent(req) {
    dbg.log2('Un-registering agent', req.rpc_params.agent, 'with server', req.rpc_params.server);

    var agent = req.rpc_params.agent;
    var entry = REGISTERED_AGENTS.agents2srvs[agent];
    if (entry) {
        //Remove agent
        delete REGISTERED_AGENTS.agents2srvs[agent];

        //TODO::NBNB Go over subscribers list and notify them on change
    }
    return;
}

function subscribe(req) {
    dbg.log2('Subscribe for agent', req.rpc_params.agent, 'by server', req.rpc_params.server);

    var agent = req.rpc_params.agent;
    var entry = REGISTERED_AGENTS.agents2srvs[agent];
    if (entry) {
        var reg = entry.registrations;
        if (_.has(reg, req.rpc_params.server)) {
            dbg.log0('server', req.rpc_params.server, 'is already subscribed for', agent);
            return;
        }
        dbg.log0('registering server', req.rpc_params.server, 'for', agent);
        reg[req.rpc_params.server] = true;
    } else {
        dbg.log0('Request for subscribe on non-existing agent', agent, 'for server',
            req.rpc_params.server);
        return;
    }
}

function unsubscribe(req) {
    dbg.log2('Unsubscribe for agent', req.rpc_params.agent, 'by server', req.rpc_params.server);

    var agent = req.rpc_params.agent;
    var entry = REGISTERED_AGENTS.agents2srvs[agent];
    if (entry) {
        var reg = entry.registrations;
        if (_.has(reg, req.rpc_params.server)) {
            delete reg[req.rpc_params.server];
        }
        return;
    }
}

function unsubscribe_all(req) {
    dbg.log2('Unsubscribe ALL by server', req.rpc_params.server);
    _.each(REGISTERED_AGENTS.agents2srvs, function(single_agent) {
        var reg = REGISTERED_AGENTS.agents2srvs[single_agent].registrations;
        if (_.has(reg, req.rpc_params.server)) {
            delete reg[req.rpc_params.server];
        }
        return;
    });
    return;
}

/*
 * Utils
 */

//Notify agent change to a singe subscriber
function notify_change(server) {
    //TODO:: loop with retries

}

function cleanup_on_close(connection) {
    _.each(connection.agents, function(agent) {
        delete REGISTERED_AGENTS.agents2srvs[agent];
        //TODO:: Should also notify on connection down to other subscribers?!
    });
}

//On startup, send registration requests to the different servers
function request_registrations() {

}
