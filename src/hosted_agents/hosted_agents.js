/* Copyright (C) 2016 NooBaa */
'use strict';

const uuid = require('node-uuid');
const path = require('path');
const util = require('util');
const fs = require('fs');
const _ = require('lodash');

const system_store = require('../server/system_services/system_store').get_instance();
const auth_server = require('../server/common_services/auth_server');
const json_utils = require('../util/json_utils');
const fs_utils = require('../util/fs_utils');
const createAgent = require('../agent/agent');
const dbg = require('../util/debug_module')(__filename);
const P = require('../util/promise');

class HostedAgents {

    static instance() {
        HostedAgents._instance = HostedAgents._instance || new HostedAgents();
        return HostedAgents._instance;
    }

    constructor() {
        this._started = false;
        this._started_agents = {};
    }

    /**
     * start hosted agents service
     */
    start() {
        return P.resolve()
            .then(() => {
                if (!this._started) {
                    this._started = true;
                    return this.reload()
                        .then(() => {
                            dbg.log0('Started hosted_agents');
                        });
                }
                dbg.log1(`What is started may never start`);
            })
            .catch(err => {
                this._started = false;
                dbg.error(`failed starting hosted_agents: ${err.stack}`);
                throw err;
            })
            .return();
    }

    /**
     * load existing agents from DB and run them
     */
    reload() {
        // start agents for all existing cloud pools
        let agents_to_start = system_store.data.pools.filter(pool => !_.isUndefined(pool.cloud_pool_info));
        dbg.log0(`will start agents for these pools: ${util.inspect(agents_to_start)}`);
        return P.map(agents_to_start, cloud_pool => this._start_cloud_agent(cloud_pool));
    }

    /**
     * stop hosted agents service
     */
    stop() {
        dbg.log0('Stopping hosted_agents');
        this._started = false;
        //stop all running agents
        _.each(this._started_agents, (agent, node_name) => this._stop_agent(node_name));
    }


    _start_cloud_agent(cloud_pool) {
        if (!this._started) return;
        if (!cloud_pool) throw new Error(`Internal error: received cloud_pool ${cloud_pool}`);
        dbg.log0(`_start_cloud_agent for cloud pool ${cloud_pool.name}`);
        const cloud_pool_id = String(cloud_pool._id);
        const node_name = 'noobaa-internal-agent-' + cloud_pool_id;

        if (this._started_agents[node_name]) {
            dbg.warn(`agent for ${cloud_pool.name}, id: ${cloud_pool._id} already started. skipping _start_cloud_agent`);
            return;
        }

        const port = process.env.SSL_PORT || 5443;
        const host_id = uuid();
        const storage_path = path.join(process.cwd(), 'agent_storage', node_name);
        const cloud_path = _.get(cloud_pool, 'cloud_pool_info.agent_info.cloud_path') ||
            `noobaa_blocks/${cloud_pool_id}`;
        const system = cloud_pool.system;

        // TODO: we don't actually need storage_path in cloud agents. see how we can remove it
        fs_utils.create_path(storage_path, fs_utils.PRIVATE_DIR_PERMISSIONS)
            .then(() => {
                // read/write token functions to pass to agent. for cloud agents the token is stored in DB
                // if we don't yet have agent info in the DB add create_node_token
                const token = auth_server.make_auth_token({
                    system_id: String(system._id),
                    account_id: system.owner._id,
                    role: 'create_node'
                });
                const token_wrapper = _get_token_wrapper(cloud_pool);
                const cloud_info = cloud_pool.cloud_pool_info;
                if (!cloud_info.agent_info || !cloud_info.agent_info.create_node_token) {
                    const existing_token = cloud_info.agent_info ? cloud_info.agent_info.node_token : null;
                    let update = {
                        pools: [{
                            _id: cloud_pool._id,
                            'cloud_pool_info.agent_info': {
                                create_node_token: token,
                                node_token: existing_token || token,
                            }
                        }]
                    };
                    if (!cloud_info.agent_info || !cloud_info.agent_info.cloud_path) {
                        update.pools[0]['cloud_pool_info.agent_info'].cloud_path = cloud_path;
                    }
                    // after upgrade of systems with old cloud_resources we will have a node_token but not create_node_token
                    // in that case we just want to add a new create_node_token
                    return system_store.make_changes({
                            update
                        })
                        .return(token_wrapper);
                }
                return token_wrapper;
            })
            .then(({ token_wrapper, create_node_token_wrapper }) => {
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
                    node_name,
                    host_id,
                    storage_path,
                    cloud_path,
                    cloud_info,
                    token_wrapper,
                    create_node_token_wrapper,
                };
                dbg.log0(`running agent with params ${util.inspect(agent_params)}`);
                const agent = createAgent(agent_params);
                this._started_agents[node_name] = {
                    agent,
                    cloud_pool
                };
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
        const agent = createAgent(agent_params);
        this._started_agents[node_name] = { agent };
        return fs_utils.create_path(storage_path, fs_utils.PRIVATE_DIR_PERMISSIONS)
            .then(() => token_wrapper.write(local_create_node_token))
            .then(() => agent.start());
    }


    _stop_agent(node_name) {
        dbg.log0(`Stopping agent for pool id ${node_name}`);
        if (!this._started_agents[node_name]) {
            dbg.warn(`${node_name} is not started. ignoring stop`);
            return;
        }
        let agent = this._started_agents[node_name].agent;
        let cloud_pool = this._started_agents[node_name].cloud_pool;
        if (agent) {
            agent.stop();
        }
        return P.resolve()
            .then(() => {
                if (cloud_pool) {
                    dbg.log0(`delete cloud_pool ${cloud_pool.name} ${cloud_pool._id}`);
                    return system_store.make_changes({
                        remove: {
                            pools: [cloud_pool._id]
                        }
                    });
                }
            })
            .then(() => {
                delete this._started_agents[node_name];
            });
    }
}



function create_cloud_agent(req) {
    return HostedAgents.instance()
        ._start_cloud_agent(req.system.pools_by_name[req.params.pool_name]);
}


function remove_cloud_agent(req) {
    dbg.log0(`got params ${util.inspect(req.params)}`);
    let node_name = req.params.node_name;
    if (!node_name) {
        if (!req.params.cloud_pool_name) {
            throw new Error('remove_cloud_agent missing parameters');
        }
        let pool = req.system.pools_by_name[req.params.cloud_pool_name];
        if (!pool) {
            throw new Error('could not find pool by name ' + req.params.cloud_pool_name);
        }
        node_name = 'noobaa-internal-agent-' + pool._id;
    }
    return HostedAgents.instance()
        ._stop_agent(node_name);
}

function _get_token_wrapper(cloud_pool) {
    const read_token = token_key => {
        const sys = system_store.data.systems[0];
        const pool = sys.pools_by_name[cloud_pool.name];
        if (!pool) throw new Error(`Pool ${cloud_pool.name}, ${cloud_pool._id} does not exist`);
        if (!pool.cloud_pool_info || !pool.cloud_pool_info.agent_info) throw new Error(`Cloud pool ${cloud_pool.name} was not initialised`);
        return P.resolve(pool.cloud_pool_info.agent_info[token_key]);
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

    return {
        token_wrapper,
        create_node_token_wrapper
    };
}






// EXPORTS
exports.create_cloud_agent = create_cloud_agent;
exports.remove_cloud_agent = remove_cloud_agent;
exports.start = req => HostedAgents.instance().start();
exports.stop = req => HostedAgents.instance().stop();
exports.create_agent = req => HostedAgents.instance().start_local_agent(req.params);
exports.remove_agent = req => HostedAgents.instance()._stop_agent(req.params.name);

// exports.background_worker = background_worker;
