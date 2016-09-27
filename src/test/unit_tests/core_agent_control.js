'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var Agent = require('../../agent/agent');
// var dbg = require('../../util/debug_module')(__filename);

var agntCtlConfig = {
    use_local: true,
    num_allocated: 0,
    allocated_agents: {},
    local_conf: {
        base_address: null,
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
};

/*
 *
 * Switch between working locally and remotely
 *
 */

function show_ctl() {
    return agntCtlConfig;
}

function use_local_agents(base_address, auth_token) {
    if (!base_address) {
        throw Error('Must supply base_address for local agents test run');
    }
    if (!auth_token) {
        throw Error('Must supply auth_token for local agents test run');
    }

    agntCtlConfig.use_local = true;
    agntCtlConfig.local_conf.base_address = base_address;
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
    return _.times(count, i => {
        var agent = new Agent({
            address: agntCtlConfig.local_conf.base_address,
            node_name: 'node' + (_num_allocated() + 1) + '_' + (Date.now() % 100000),
            // passing token instead of storage_path to use memory storage
            token: agntCtlConfig.local_conf.auth,
        });
        agntCtlConfig.allocated_agents[agent.node_name] = {
            agent: agent,
            started: false
        };
        agntCtlConfig.num_allocated++;
    });
}

function cleanup_agents() {
    return P.fcall(() => {
            return stop_all_agents();
        })
        .then(() => {
            _.each(agntCtlConfig.allocated_agents, id => {
                id.agent = null;
            });
            agntCtlConfig.allocated_agents = {};
            agntCtlConfig.num_allocated = 0;
        });
}

function start_agent(node_name) {
    var ent;
    return P.fcall(() => {
            ent = get_agent_entry(node_name);
            if (!ent.started) {
                return ent.agent.start();
            }
        })
        .then(() => {
            ent.started = true;
        });
}

function stop_agent(node_name) {
    var ent;
    return P.fcall(() => {
            ent = get_agent_entry(node_name);
            if (ent.started) {
                return ent.agent.stop();
            }
        })
        .then(() => {
            ent.started = false;
        });
}

function start_all_agents() {
    return P.all(_.map(agntCtlConfig.allocated_agents,
        (entry, node_name) => start_agent(node_name)
    ));
}

function stop_all_agents() {
    return P.all(_.map(agntCtlConfig.allocated_agents,
        (entry, node_name) => stop_agent(node_name)
    ));
}

function get_agents_list() {
    return _.map(agntCtlConfig.allocated_agents, (stat, id) => ({
        node_name: id,
        started: stat.started
    }));
}


/*
 *
 * Internal Utilities
 *
 */
function _num_allocated() {
    return agntCtlConfig.num_allocated;
}


function get_agent_entry(node_name) {
    var ent = agntCtlConfig.allocated_agents[node_name];
    if (!ent) {
        throw new Error('Agent not found ' + node_name);
    }
    return ent;
}
