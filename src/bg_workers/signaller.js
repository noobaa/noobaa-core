'use strict';

module.exports = {
    signal: signal,
    register_agent: register_agent,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    unsubscribe_all: unsubscribe_all,
};

var _ = require('lodash');
//var P = require('../util/promise');
var dbg = require('../util/debug_module')(__filename);

var REGISTERED_AGENTS = {
    agents2srvs: {}
};


/* TODO
   1) Register service in the bg workers rpc
   2) Use actual RPC for api
   3) Call RPC on signal and return data to the caller
   4) Notify Change Implementation, with retries
   5) Register agents in batches
   6) When signaller starts, send 'request registration' to all the webservers
*/

/*
 * SIGNALLER API
 */
function signal(req) {
    dbg.log4('Signal request for', req.rpc_params.agent);

    var agent = req.rpc_params.agent;
    if (_.has(REGISTERED_AGENTS.agents2srvs, agent)) {
        var reg = REGISTERED_AGENTS.agents2srvs[agent];
        return print_server(reg.server, reg.port) + ', registration:' + reg.registrations;
    } else {
        return 'none';
    }
}

function register_agent(req) {
    dbg.log0('Registering agent', req.rpc_params.agent, 'with server',
        print_server(req.rpc_params.server, req.rpc_params.port));

    var agent = req.rpc_params.agent;
    if (_.has(REGISTERED_AGENTS.agents2srvs, agent)) {
        //Update data
        var reg = REGISTERED_AGENTS.agents2srvs[agent].registrations;
        REGISTERED_AGENTS.agents2srvs[agent] = {
            server: req.rpc_params.server,
            port: req.rpc_params.port,
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
            port: req.rpc_params.port,
            registrations: {}
        };
    }
    return;
}

function subscribe(req) {
    dbg.log0('Subscribe for agent', req.rpc_params.agent, 'by server',
        print_server(req.rpc_params.server, req.rpc_params.port));

    var agent = req.rpc_params.agent;
    if (_.has(REGISTERED_AGENTS.agents2srvs, agent)) {
        var reg = REGISTERED_AGENTS.agents2srvs[agent].registrations;
        if (_.has(reg, req.rpc_params.server) &&
            reg[req.rpc_params.server] === req.rpc_params.port) {
            dbg.log0('server', print_server(req.rpc_params.server, req.rpc_params.port),
                'is already subscribed for', agent);
            return;
        }
        dbg.log0('registering server', print_server(req.rpc_params.server, req.rpc_params.port),
            'for', agent);
        reg[req.rpc_params.server] = req.rpc_params.port;
    } else {
        dbg.log0('Request for subscribe on non-existing agent', agent, 'for server',
            print_server(req.rpc_params.server, req.rpc_params.port));
        return;
    }
}

function unsubscribe(req) {
    dbg.log0('Unsubscribe for agent', req.rpc_params.agent, 'by server',
        print_server(req.rpc_params.server, req.rpc_params.port));

    var agent = req.rpc_params.agent;
    if (_.has(REGISTERED_AGENTS.agents2srvs, agent)) {
        var reg = REGISTERED_AGENTS.agents2srvs[agent].registrations;
        if (_.has(reg, req.rpc_params.server)) {
            delete reg[req.rpc_params.server];
        }
        return;
    }
}

function unsubscribe_all(req) {
    dbg.log0('Unsubscribe ALL by server', print_server(req.rpc_params.server, req.rpc_params.port));
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
function print_server(host, port) {
    return host + ":" + port;
}

//Notify agent change to a singe subscriber
function notify_change(server) {
    //TODO:: loop with retries
    dbg.log0('Sending RPC to', print_server(server.server, server.port));
}

//On startup, send registration requests to the different servers
function request_registrations() {

}
