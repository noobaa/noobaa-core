/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const uuid = require('node-uuid');
const path = require('path');
const fs = require('fs');
const util = require('util');

const dbg = require('../util/debug_module')(__filename);
const P = require('../util/promise');
const fs_utils = require('../util/fs_utils');
const Agent = require('../agent/agent');
const system_store = require('../server/system_services/system_store').get_instance();
const auth_server = require('../server/common_services/auth_server');
const json_utils = require('../util/json_utils');

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
        const system = system_store.data.systems[0];
        if (!system) return;
        const cloud_pools = _.filter(system.pools_by_name, pool => Boolean(pool.cloud_pool_info));
        // start agent for all cloud pools that doesn't already have a running agent
        const pools_to_start = _.filter(cloud_pools, pool => _.isUndefined(this._started_agents[pool.name]));
        // stop all running agents that doesn't have a cloud pool in the DB
        const agents_to_stop = _.filter(this._started_agents, (agent, name) => _.isUndefined(system.pools_by_name[name]));

        if (!pools_to_start.length && !agents_to_stop.length) return;

        dbg.log0(`stopping the following agents: ${agents_to_stop}`);
        _.each(agents_to_stop, (agent, name) => this.stop_agent(name));

        this._started = true;
        dbg.log0(`starting agents for the following pools: ${pools_to_start.map(pool => pool.name)}`);
        return P.map(pools_to_start, pool => this.start_cloud_agent(pool))
            .catch(err => {
                this._started = false;
                dbg.error(`failed starting hosted_agents: ${err.stack}`);
                throw err;
            })
            .return();
    }


    stop() {
        this._started = false;
        //stop all running agents
        _.each(this._started_agents, (agent, name) => this.stop_agent(name));
    }


    start_cloud_agent(cloud_pool) {
        if (!this._started) return;
        if (this._started_agents[cloud_pool.name]) {
            dbg.warn(`agent ${cloud_pool.name} already started. skipping start_cloud_agent`);
            return;
        }

        const port = process.env.SSL_PORT || 5443;
        const host_id = uuid();
        const node_name = 'noobaa-internal-agent-' + cloud_pool.name;
        const storage_path = path.join(process.cwd(), 'agent_storage', node_name);

        const system = system_store.data.systems[0];
        const auth_parmas = {
            system_id: String(system._id),
            account_id: system.owner._id,
            role: 'create_node'
        };

        // read/write token functions to pass to agent. for cloud agents the token is stored in DB
        const token = auth_server.make_auth_token(auth_parmas);

        const read_token = token_key => {
            const sys = system_store.data.systems[0];
            const pool = sys.pools_by_name[cloud_pool.name];
            return P.resolve(pool.cloud_pool_info.agent_info[token_key] || token);
        };

        const write_token = (new_token, token_key) => {
            dbg.log1(`write_token with params: ${new_token}, ${token_key}`);
            const db_update = {
                _id: cloud_pool._id,
            };
            db_update['cloud_pool_info.agent_info.' + token_key] = new_token;
            return system_store.make_changes({
                update: {
                    pools: [db_update]
                }
            });
        };

        const token_wrapper = {
            read: () => read_token('node_token'),
            write: new_token => write_token(new_token, 'node_token'),
        };
        const create_node_token_wrapper = {
            read: () => read_token('create_node_token'),
            write: new_token => write_token(new_token, 'create_node_token')
        };

        // TODO: we don't actually need storage_path in cloud agents. see how we can remove it
        fs_utils.create_path(storage_path, fs_utils.PRIVATE_DIR_PERMISSIONS)
            .then(() => {
                // if we don't yet have agent info in the DB add create_node_token
                const cloud_info = cloud_pool.cloud_pool_info;
                if (!cloud_info.agent_info || !cloud_info.agent_info.create_node_token) {
                    // after upgrade of systems with old cloud_resources we will have a node_token but not create_node_token
                    // in that case we just want to add a new create_node_token
                    const existing_token = cloud_info.agent_info ? cloud_info.agent_info.node_token : null;
                    return system_store.make_changes({
                        update: {
                            pools: [{
                                _id: cloud_pool._id,
                                'cloud_pool_info.agent_info': {
                                    create_node_token: token,
                                    node_token: existing_token || token
                                }
                            }]
                        }
                    });
                }
            })
            .then(() => {
                const cloud_info = {
                    endpoint: cloud_pool.cloud_pool_info.endpoint,
                    endpoint_type: cloud_pool.cloud_pool_info.endpoint_type,
                    target_bucket: cloud_pool.cloud_pool_info.target_bucket,
                    access_keys: {
                        access_key: cloud_pool.cloud_pool_info.access_keys.access_key,
                        secret_key: cloud_pool.cloud_pool_info.access_keys.secret_key
                    },
                    cloud_pool_name: cloud_pool.name
                };
                const agent_params = {
                    address: 'wss://127.0.0.1:' + port,
                    node_name: node_name,
                    host_id: host_id,
                    storage_path: storage_path,
                    cloud_info: cloud_info,
                    token_wrapper: token_wrapper,
                    create_node_token_wrapper: create_node_token_wrapper,
                };
                dbg.log0(`running agent with params ${util.inspect(agent_params)}`);
                const agent = new Agent(agent_params);
                this._started_agents[cloud_pool.name] = agent;
                return agent.start();
            });
    }

    // Currently this is used for tests only. if we want to use it for real purposes
    // we need to review it more carefully.
    start_local_agent(params) {
        if (!this._started) return;

        const port = process.env.SSL_PORT || 5443;
        const host_id = uuid();
        const node_name = 'noobaa-internal-agent-' + params.name;
        const storage_path = path.join(process.cwd(), 'agent_storage', node_name);

        const system = system_store.data.systems[0];
        const auth_parmas = {
            system_id: String(system._id),
            account_id: system.owner._id,
            role: 'create_node'
        };

        // read/write token functions to pass to agent. for cloud agents the token is stored in DB
        let local_create_node_token = auth_server.make_auth_token(auth_parmas);

        const token_wrapper = {
            read: () => fs.readFileAsync(path.join(storage_path, 'token')),
            write: token => fs_utils.replace_file(path.join(storage_path, 'token'), token),
        };
        const create_node_token_wrapper = {
            read: () => P.resolve(local_create_node_token),
            write: new_token => {
                local_create_node_token = new_token;
            }
        };

        const agent_params = {
            address: 'wss://127.0.0.1:' + port,
            node_name: node_name,
            host_id: host_id,
            storage_path: storage_path,
            token_wrapper: token_wrapper,
            create_node_token_wrapper: create_node_token_wrapper,
            agent_conf: new json_utils.JsonFileWrapper('agent_conf.json')
        };

        dbg.log0(`running agent with params ${util.inspect(agent_params)}`);
        const agent = new Agent(agent_params);
        this._started_agents[params.name] = agent;
        return fs_utils.create_path(storage_path, fs_utils.PRIVATE_DIR_PERMISSIONS)
            .then(() => token_wrapper.write(local_create_node_token))
            .then(() => agent.start());
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
        const cloud_pool = system_store.data.systems[0].pools_by_name[req.params.name];
        return HostedAgents.instance().start_cloud_agent(cloud_pool);
    }
    return HostedAgents.instance().start_local_agent(req.params);
}


function remove_agent(req) {
    return HostedAgents.instance().stop_agent(req.params.name);
}



// EXPORTS
exports.create_agent = create_agent;
exports.remove_agent = remove_agent;
exports.start = req => HostedAgents.instance().start();
exports.stop = req => HostedAgents.instance().stop();
// exports.background_worker = background_worker;
