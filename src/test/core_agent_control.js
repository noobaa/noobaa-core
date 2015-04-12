// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var path = require('path');
var mongoose = require('mongoose');
var Semaphore = require('noobaa-util/semaphore');
var api = require('../api');
var db = require('../server/db');
var Agent = require('../agent/agent');
var config = require('../../config.js');
var dbg = require('noobaa-util/debug_module')(__filename);

var agntCtlConfig = {
    use_local: true,
    num_allocated: 0,
    allocated_agents: {},
    local_conf: {
        utilitest: null,
        auth: null,
    },
    remote_conf: {},
};

module.exports = {
    show_ctl: show_ctl,
    use_local_agents: use_local_agents,
    use_remote_agents: use_remote_agents,

    create_agent: create_agent,
    cleanup_agents: cleanup_agents,
    start_agent: start_agent,
    stop_agent: stop_agent,
    start_all_agents: start_all_agents,
    stop_all_agents: stop_all_agents,
    get_agents_list: get_agents_list,

    /*TODO: add the following:
     * delete_block: delete_block,
     * corrupt_block: corrupt_block,
     * comm_error_inject: comm_error_inject,
     */
};

/*
 *
 * Switch between working locally and remotely
 *
 */

function show_ctl() {
    return agntCtlConfig;
}

function use_local_agents(utilitest, auth_token) {
    if (!utilitest) {
        throw Error('Must supply utilitest for local agents test run');
    } else if (!auth_token) {
        throw Error('Must supply auth_token for local agents test run');
    }

    agntCtlConfig.use_local = true;
    agntCtlConfig.local_conf.utilitest = utilitest;
    agntCtlConfig.local_conf.auth = _.clone(auth_token);
}

function use_remote_agents() {
    //TODO: not supported yet
    agntCtlConfig.use_local = true;
}

/*
 *
 * Agent(s) control path
 *
 */

function create_agent(howmany) {
    var count = howmany || 1;
    return Q.all(_.times(count, function(i) {
        return Q.fcall(function() {
                var agent_a = new Agent({
                    address: 'http://localhost:' + agntCtlConfig.local_conf.utilitest.http_port(),
                    node_name: 'node' + (_num_allocated() + 1) + '_' + (Date.now() % 100000),
                    // passing token instead of storage_path to use memory storage
                    token: agntCtlConfig.local_conf.auth,
                    use_http_server: true,
                });
                return agent_a;
            })
            .then(function(agent) {
                agntCtlConfig.allocated_agents[agent.node_name] = {
                    ref: agent,
                    started: false
                };
                agntCtlConfig.num_allocated++;
                return;
            });
    }));
}

function cleanup_agents() {
    return Q.fcall(function() {
            return stop_all_agents();
        })
        .then(function() {
            agntCtlConfig.allocated_agents = {};
            agntCtlConfig.num_allocated = 0;
        });
}

function start_agent(node_name) {
    if (agntCtlConfig.allocated_agents.hasOwnProperty(node_name) &&
        !agntCtlConfig.allocated_agents[node_name].started) {
        return Q.fcall(function() {
                return agntCtlConfig.allocated_agents[node_name].ref.start();
            })
            .then(function() {
                agntCtlConfig.allocated_agents[node_name].started = true;
            });
    }

    return Q.reject('No node_name supplied');
}

function stop_agent(node_name) {
    if (agntCtlConfig.allocated_agents.hasOwnProperty(node_name) &&
        agntCtlConfig.allocated_agents[node_name].started) {
        return Q.fcall(function() {
                return agntCtlConfig.allocated_agents[node_name].ref.stop();
            })
            .then(function() {
                agntCtlConfig.allocated_agents[node_name].started = false;
            });
    }

    return Q.reject('No node_name supplied');
}

function start_all_agents() {
    return Q.all(_.map(agntCtlConfig.allocated_agents,
        function(data, id) {
            if (data.started === false) {
                return start_agent(id);
            }
        }));
}

function stop_all_agents() {
    return Q.all(_.map(agntCtlConfig.allocated_agents,
        function(data, id) {
            if (data.started === true) {
                return stop_agent(id);
            }
        }));
}

function get_agents_list() {
    return _.map(agntCtlConfig.allocated_agents, function(stat, id) {
        return {
            node_name: id,
            started: stat.started
        };
    });
}

/*
 *
 * Internal Utilities
 *
 */
function _num_allocated() {
    return agntCtlConfig.num_allocated;
}
