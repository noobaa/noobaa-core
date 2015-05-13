// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var Agent = require('../agent/agent');
// var dbg = require('noobaa-util/debug_module')(__filename);

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

    // Control
    create_agent: create_agent,
    cleanup_agents: cleanup_agents,
    start_agent: start_agent,
    stop_agent: stop_agent,
    start_all_agents: start_all_agents,
    stop_all_agents: stop_all_agents,
    get_agents_list: get_agents_list,

    //I/O
    read_block: read_block,
    write_block: write_block,
    delete_blocks: delete_blocks,
    corrupt_blocks: corrupt_blocks,
    list_blocks: list_blocks,
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
 * Agent(s) Control path
 *
 */

function create_agent(howmany) {
    var count = howmany || 1;
    return Q.all(_.times(count, function(i) {
        return Q.fcall(function() {
                var agent = new Agent({
                    // address: 'ws://localhost:' + agntCtlConfig.local_conf.utilitest.http_port(),
                    node_name: 'node' + (_num_allocated() + 1) + '_' + (Date.now() % 100000),
                    // passing token instead of storage_path to use memory storage
                    token: agntCtlConfig.local_conf.auth,
                });
                return agent;
            })
            .then(function(agent) {
                agntCtlConfig.allocated_agents[agent.node_name] = {
                    agent: agent,
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
            _.each(agntCtlConfig.allocated_agents, function(id) {
                id.agent = null;
            });
            agntCtlConfig.allocated_agents = {};
            agntCtlConfig.num_allocated = 0;
        });
}

function start_agent(node_name) {
    if (agntCtlConfig.allocated_agents.hasOwnProperty(node_name) &&
        !agntCtlConfig.allocated_agents[node_name].started) {
        return Q.fcall(function() {
                return agntCtlConfig.allocated_agents[node_name].agent.start();
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
                return agntCtlConfig.allocated_agents[node_name].agent.stop();
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
 * Agent(s) I/O path
 *
 */
function read_block(node_name, block_id) {
    if (!block_id) {
        return Q.reject('No block_id supplied');
    }

    var req = {
        block_id: block_id,
    };

    if (agntCtlConfig.allocated_agents.hasOwnProperty(node_name) &&
        agntCtlConfig.allocated_agents[node_name].started) {
        return Q.fcall(function() {
            return agntCtlConfig.allocated_agents[node_name].agent.read_block(req);
        });
    }

    return Q.reject('No node_name supplied');
}

function write_block(node_name, block_id, data) {
    if (!block_id || !data) {
        return Q.reject('No block_id/data supplied');
    }

    var req = {
        block_id: block_id,
        data: data,
    };

    if (agntCtlConfig.allocated_agents.hasOwnProperty(node_name) &&
        agntCtlConfig.allocated_agents[node_name].started) {
        return Q.fcall(function() {
            return agntCtlConfig.allocated_agents[node_name].agent.write_block(req);
        });
    }

    return Q.reject('No node_name supplied');
}

function delete_blocks(node_name, block_ids) {
    if (!block_ids) {
        return Q.reject('No block_ids supplied');
    }

    var req = {
        blocks: _.map(block_ids, function(block) {
            return block._id.toString();
        })
    };

    if (agntCtlConfig.allocated_agents.hasOwnProperty(node_name) &&
        agntCtlConfig.allocated_agents[node_name].started) {
        return Q.fcall(function() {
            return agntCtlConfig.allocated_agents[node_name].agent.delete_blocks(req);
        });
    }

    return Q.reject('No node_name supplied');
}

function corrupt_blocks(node_name, block_ids) {
    if (!block_ids) {
        return Q.reject('No block_ids supplied');
    }

    /*
    var req = {
        blocks: _.map(block_ids, function(block) {
            return block._id.toString();
        })
    };
    */

    if (agntCtlConfig.allocated_agents.hasOwnProperty(node_name) &&
        agntCtlConfig.allocated_agents[node_name].started) {
        return Q.fcall(function() {
            return agntCtlConfig.allocated_agents[node_name].agent.corrupt_blocks(block_ids);
        });
    }

    return Q.reject('No node_name supplied');
}

function list_blocks(node_name) {
    if (agntCtlConfig.allocated_agents.hasOwnProperty(node_name) &&
        agntCtlConfig.allocated_agents[node_name].started) {
        return Q.fcall(function() {
            return agntCtlConfig.allocated_agents[node_name].agent.list_blocks();
        });
    }

    return Q.reject('No node_name supplied');
}

/*
 *
 * Internal Utilities
 *
 */
function _num_allocated() {
    return agntCtlConfig.num_allocated;
}
