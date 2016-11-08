'use strict';

const _ = require('lodash');
const uuid = require('node-uuid');
// const child_process = require('child_process');
const path = require('path');
// const fs = require('fs');
var util = require('util');

const dbg = require('../../util/debug_module')(__filename);
// const supervisor = require('../utils/supervisor_ctrl.js');
// const os_utils = require('../../util/os_utils');
const P = require('../../util/promise');
const fs_utils = require('../../util/fs_utils');
const Agent = require('../../agent/agent');
const system_store = require('../system_services/system_store').get_instance();
const auth_server = require('../common_services/auth_server');



class HostedAgents {

    static instance() {
        if (!HostedAgents._instance) {
            HostedAgents._instance = new HostedAgents();
        }
        return HostedAgents._instance;
    }

    constructor() {
        this._started = false;
        this._started_agents = {};
    }

    start() {
        let system = system_store.data.systems[0];
        let cloud_pools = _.filter(system.pools_by_name, pool => Boolean(pool.cloud_pool_info));
        // start agent for all cloud pools that doesn't already have a running agent
        let pools_to_start = _.filter(cloud_pools, pool => _.isUndefined(this._started_agents[pool.name]));
        // stop all running agents that doesn't have a cloud pool in the DB
        let agents_to_stop = _.filter(this._started_agents, (agent, name) => _.isUndefined(system.pools_by_name[name]));

        dbg.log0(`stopping the following agents: ${agents_to_stop}`);
        _.each(agents_to_stop, (agent, name) => this.stop_agent(name));

        dbg.log0(`starting agents for the following pools: ${pools_to_start.map(pool => pool.name)}`);
        return P.map(pools_to_start, pool => this.start_cloud_agent(pool));
    }


    stop() {
        //stop all running agents
        _.each(this._started_agents, (agent, name) => this.stop_agent(name));
    }


    start_cloud_agent(cloud_pool) {
        if (this._started_agents[cloud_pool.name]) {
            dbg.warn(`agent ${cloud_pool.name} already started. skipping start_cloud_agent`);
            return;
        }

        let port = process.env.SSL_PORT || 5443;
        let host_id = uuid();
        let node_name = 'noobaa-internal-agent-' + cloud_pool.name;
        let storage_path = path.join(process.cwd(), 'agent_storage', node_name);

        let system = system_store.data.systems[0];
        let auth_parmas = {
            system_id: String(system._id),
            account_id: system.owner._id,
            role: 'create_node'
        };

        // read/write token functions to pass to agent. for cloud agents the token is stored in DB
        let token = auth_server.make_auth_token(auth_parmas);
        let read_token = () => {
            let sys = system_store.data.systems[0];
            let pool = sys.pools_by_name[cloud_pool.name];
            return P.resolve(pool.cloud_pool_info.agent_info.node_token || token);
        };


        let write_token = (new_token, token_key) => {
            dbg.log1(`write_token with params: ${new_token}, ${token_key}`);
            let sys = system_store.data.systems[0];
            let cloud_info = sys.pools_by_name[cloud_pool.name].cloud_pool_info;
            cloud_info.agent_info[token_key] = new_token;
            return system_store.make_changes({
                update: {
                    pools: [{
                        _id: cloud_pool._id,
                        cloud_pool_info: cloud_info
                    }]
                }
            });
        };

        let token_wrapper = {
            read: read_token,
            write: new_token => write_token(new_token, 'node_token'),
            create_node_token: token,
            update_create_node_token: new_token => write_token(new_token, 'create_node_token'),
        };

        // TODO: we don't actually need storage_path in cloud agents. see how we can remove it
        fs_utils.create_path(storage_path, fs_utils.PRIVATE_DIR_PERMISSIONS)
            .then(() => {
                // if we don't yet have agent info in the DB add create_node_token
                let cloud_info = cloud_pool.cloud_pool_info;
                if (!cloud_info.agent_info || !cloud_info.agent_info.create_node_token) {
                    // after upgrade of systems with old cloud_resources we will have a node_token but not create_node_token
                    // in that case we just want to add a new create_node_token
                    let existing_token = cloud_info.agent_info ? cloud_info.agent_info.node_token : null;
                    let agent_info = {
                        create_node_token: token,
                        node_token: existing_token || token
                    };
                    cloud_info.agent_info = agent_info;
                    return system_store.make_changes({
                        update: {
                            pools: [{
                                _id: cloud_pool._id,
                                cloud_pool_info: cloud_info
                            }]
                        }
                    });
                }
            })
            .then(() => {
                let cloud_info = {
                    endpoint: cloud_pool.cloud_pool_info.endpoint,
                    endpoint_type: cloud_pool.cloud_pool_info.endpoint_type,
                    target_bucket: cloud_pool.cloud_pool_info.target_bucket,
                    access_keys: {
                        access_key: cloud_pool.cloud_pool_info.access_keys.access_key,
                        secret_key: cloud_pool.cloud_pool_info.access_keys.secret_key
                    },
                    cloud_pool_name: cloud_pool.name
                };
                let agent_params = {
                    address: 'wss://127.0.0.1:' + port,
                    node_name: node_name,
                    host_id: host_id,
                    storage_path: storage_path,
                    cloud_info: cloud_info,
                    token_wrapper: token_wrapper
                };
                dbg.log0(`running agent with params ${util.inspect(agent_params)}`);
                let agent = new Agent(agent_params);
                this._started_agents[cloud_pool.name] = agent;
                return agent.start();
            });
    }


    stop_agent(name) {
        dbg.log0(`stopping agent ${name}`);
        if (this._started_agents[name]) {
            this._started_agents[name].stop();
        }
        delete this._started_agents[name];
    }
}




function create_agent(req) {
    if (req.params.cloud_info) {
        let cloud_pool = system_store.data.systems[0].pools_by_name[req.params.name];
        return HostedAgents.instance().start_cloud_agent(cloud_pool);
    }
    throw new Error('NOT IMPLEMENTED');
}


function remove_agent(req) {
    HostedAgents.instance().stop_agent(req.params.name);
}



// EXPORTS
exports.create_agent = create_agent;
exports.remove_agent = remove_agent;
exports.start = req => HostedAgents.instance().start();
exports.stop = req => HostedAgents.instance().stop();
// exports.background_worker = background_worker;
