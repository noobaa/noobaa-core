'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var Agent = require('../agent/agent');
// var dbg = require('../util/debug_module')(__filename);

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
            _.each(agntCtlConfig.allocated_agents, id => id.agent = null);
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
 * Agent(s) I/O path
 *
 */
function read_block(node_name, block_id) {
    return P.fcall(() => {
        if (true) {
            throw new Error('FUNCTION NOT MAINTAINED TO RECENT API CHANGES');
        }

        if (!block_id) {
            throw new Error('No block_id supplied');
        }

        var req = {
            block_id: block_id,
        };

        var ent = get_agent_entry(node_name);
        if (ent.started) {
            return ent.agent.read_block(req);
        }
    });
}

function write_block(node_name, block_id, data) {
    return P.fcall(() => {
        if (true) {
            throw new Error('FUNCTION NOT MAINTAINED TO RECENT API CHANGES');
        }

        if (!block_id || !data) {
            throw new Error('No block_id/data supplied');
        }

        var req = {
            block_id: block_id,
            data: data,
        };

        var ent = get_agent_entry(node_name);
        if (ent.started) {
            return ent.agent.write_block(req);
        }
    });
}

function delete_blocks(node_name, block_ids) {
    return P.fcall(() => {
        if (!block_ids) {
            throw new Error('No block_ids supplied');
        }

        var req = {
            blocks: _.map(block_ids, block => block._id.toString())
        };

        var ent = get_agent_entry(node_name);
        if (ent.started) {
            return ent.agent.delete_blocks(req);
        }
    });
}

function corrupt_blocks(node_name, block_ids) {
    return P.fcall(() => {
        if (!block_ids) {
            throw new Error('No block_ids supplied');
        }

        /*
        var req = {
            blocks: _.map(block_ids, block => block._id.toString())
        };
        */

        var ent = get_agent_entry(node_name);
        if (ent.started) {
            return ent.agent.corrupt_blocks(block_ids);
        }
    });
}

function list_blocks(node_name) {
    return P.fcall(() => {
        var ent = get_agent_entry(node_name);
        if (ent.started) {
            return ent.agent.list_blocks();
        }
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


function get_agent_entry(node_name) {
    var ent = agntCtlConfig.allocated_agents[node_name];
    if (!ent) {
        throw new Error('Agent not found ' + node_name);
    }
    return ent;
}
