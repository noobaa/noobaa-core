/* Copyright (C) 2016 NooBaa */
'use strict';

const uuid = require('uuid/v4');
const path = require('path');
const util = require('util');
const fs = require('fs');
const _ = require('lodash');
const os = require('os');
const dns = require('dns');
const url = require('url');

const system_store = require('../server/system_services/system_store').get_instance();
const auth_server = require('../server/common_services/auth_server');
const json_utils = require('../util/json_utils');
const fs_utils = require('../util/fs_utils');
const Agent = require('../agent/agent');
const dbg = require('../util/debug_module')(__filename);
const P = require('../util/promise');
const promise_utils = require('../util/promise_utils');
const config = require('../../config');


const ENDPOINT_DNS_CACHE_TTL = 60000;


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
                            this._monitor_stats();
                            this._refresh_hosts_addresses();
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
        const agents_to_start = system_store.data.pools.filter(pool =>
            (!_.isUndefined(pool.cloud_pool_info) || !_.isUndefined(pool.mongo_pool_info))
        );
        dbg.log0(`will start agents for these pools: ${util.inspect(agents_to_start)}`);
        return P.map(agents_to_start, pool => this._start_pool_agent(pool));
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


    _monitor_stats() {
        promise_utils.pwhile(() => true, () => {
            const cpu_usage = process.cpuUsage(this.cpu_usage); //usage since last sample
            const mem_usage = process.memoryUsage();
            dbg.log0(`hosted_agent_stats_titles - process: cpu_usage_user, cpu_usage_sys, mem_usage_rss`);
            dbg.log0(`hosted_agent_stats_values - process: ${cpu_usage.user}, ${cpu_usage.system}, ${mem_usage.rss}`);
            for (const agent of Object.keys(this._started_agents)) {
                const agent_stats = this._started_agents[agent].agent.sample_stats();
                if (agent_stats) {
                    const agent_stats_keys = Object.keys(agent_stats);
                    dbg.log0(`hosted_agent_stats_titles - ${agent}: ` + agent_stats_keys.join(', '));
                    dbg.log0(`hosted_agent_stats_values - ${agent}: ` + agent_stats_keys.map(key => agent_stats[key]).join(', '));
                }
            }
            return P.delay(60000);
        });
    }

    _refresh_hosts_addresses() {
        if (os.type() !== 'Linux') return;
        let resolved_hosts = [];
        promise_utils.pwhile(() => true, () => {
            const cloud_endpoints = _.values(this._started_agents)
                .filter(entry => Boolean(entry.pool.cloud_pool_info))
                .map(entry => {
                    const endpoint_host = url.parse(entry.pool.cloud_pool_info.endpoint).host;
                    if (entry.pool.cloud_pool_info.endpoint_type === 'AZURE') {
                        return entry.pool.cloud_pool_info.access_keys.access_key + '.' + endpoint_host;
                    } else {
                        return endpoint_host;
                    }
                });
            return P.map(cloud_endpoints, endpoint =>
                    P.fromCallback(callback => dns.resolve4(endpoint, callback))
                    .then(addresses => ({ endpoint, address: addresses[0] }))
                    .catch(err => {
                        dbg.warn(`failed resolving endpoint ${endpoint} with error`, err);
                        return;
                    }))
                .then(hosts => {
                    dbg.log0(`got these addresses from dns queries:`, hosts);
                    // filter out unresolved endpoints
                    resolved_hosts = hosts.filter(Boolean);
                    let etc_hosts_string = '127.0.0.1\t\tlocalhost localhost.localdomain localhost4 localhost4.localdomain4\n' +
                        '::1\t\tlocalhost localhost.localdomain localhost6 localhost6.localdomain6\n\n#resolved cloud resources\n';
                    etc_hosts_string += resolved_hosts.map(host => host.address + '\t\t' + host.endpoint).join('\n');
                    const tmp_etc_hosts = '/tmp/etc_hosts' + Date.now();
                    return fs.writeFileAsync(tmp_etc_hosts, etc_hosts_string)
                        .then(() => fs.renameAsync(tmp_etc_hosts, '/etc/hosts'))
                        .then(() => dbg.log0('/etc/hosts updated with', resolved_hosts));
                })
                .catch(err => dbg.error('got error in _refresh_hosts_addresses:', err))
                .delay(ENDPOINT_DNS_CACHE_TTL);
        });
    }


    _start_pool_agent(pool) {
        if (!this._started) return;
        if (!pool) throw new Error(`Internal error: received pool ${pool}`);
        dbg.log0(`_start_pool_agent for pool ${pool.name}`);
        const pool_id = String(pool._id);
        const node_name = 'noobaa-internal-agent-' + pool_id;

        if (this._started_agents[node_name]) {
            dbg.warn(`agent for ${pool.name}, id: ${pool._id} already started. skipping _start_pool_agent`);
            return;
        }

        const port = process.env.SSL_PORT || 5443;
        const host_id = config.HOSTED_AGENTS_HOST_ID + pool_id;
        const storage_path = path.join(process.cwd(), 'noobaa_storage', node_name);
        const pool_property_path = pool.resource_type === 'INTERNAL' ?
            'mongo_pool_info.agent_info.mongo_path' : 'cloud_pool_info.agent_info.cloud_path';
        const pool_path = _.get(pool, pool_property_path, `noobaa_blocks/${pool_id}`);
        const pool_path_property = pool.resource_type === 'INTERNAL' ? 'mongo_path' : 'cloud_path';
        const pool_info_property = pool.resource_type === 'INTERNAL' ? 'mongo_info' : 'cloud_info';
        const system = pool.system;

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
                const token_wrapper = _get_pool_token_wrapper(pool);
                const pool_info = pool.resource_type === 'INTERNAL' ?
                    pool.mongo_pool_info : pool.cloud_pool_info;
                if (!pool_info.agent_info || !pool_info.agent_info.create_node_token) {
                    const existing_token = pool_info.agent_info ? pool_info.agent_info.node_token : null;
                    const pool_agent_path = pool.resource_type === 'INTERNAL' ?
                        'mongo_pool_info' : 'cloud_pool_info';
                    let update = {
                        pools: [{
                            _id: pool._id,
                            [`${pool_agent_path}.agent_info`]: {
                                create_node_token: token,
                                node_token: existing_token || token
                            }
                        }]
                    };
                    if (!pool_info.agent_info || !pool_info.agent_info[pool_path_property]) {
                        update.pools[0][`${pool_agent_path}.agent_info`][pool_path_property] = pool_path;
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
                const pool_info = pool.resource_type === 'CLOUD' ? {
                    endpoint: pool.cloud_pool_info.endpoint,
                    endpoint_type: pool.cloud_pool_info.endpoint_type,
                    target_bucket: pool.cloud_pool_info.target_bucket,
                    access_keys: {
                        access_key: pool.cloud_pool_info.access_keys.access_key,
                        secret_key: pool.cloud_pool_info.access_keys.secret_key
                    },
                    pool_name: pool.name
                } : {
                    pool_name: pool.name
                };
                const agent_params = {
                    address: 'wss://127.0.0.1:' + port,
                    proxy: system.phone_home_proxy_address,
                    node_name,
                    host_id,
                    storage_path,
                    token_wrapper,
                    create_node_token_wrapper,
                };
                agent_params[pool_path_property] = pool_path;
                agent_params[pool_info_property] = pool_info;
                dbg.log0(`running agent with params ${util.inspect(agent_params)}`);
                const agent = new Agent(agent_params);
                this._started_agents[node_name] = {
                    agent,
                    pool
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
        const storage_path = path.join(process.cwd(), 'noobaa_storage', node_name);

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
        this._started_agents[node_name] = { agent };
        return fs_utils.create_path(storage_path, fs_utils.PRIVATE_DIR_PERMISSIONS)
            .then(() => token_wrapper.write(local_create_node_token))
            .then(() => agent.start());
    }


    _stop_agent(node_name, should_clean) {
        dbg.log0(`Stopping agent for pool id ${node_name}`);
        if (!this._started_agents[node_name]) {
            dbg.warn(`${node_name} is not started. ignoring stop`);
            return;
        }
        let agent = this._started_agents[node_name].agent;
        let agent_pool = this._started_agents[node_name].pool;
        if (agent) {
            agent.stop();
        }
        return P.resolve()
            .then(() => {
                if (agent_pool && should_clean) {
                    dbg.log0(`delete agent_pool ${agent_pool.name} ${agent_pool._id}`);
                    return system_store.make_changes({
                        remove: {
                            pools: [agent_pool._id]
                        }
                    });
                }
            })
            .then(() => {
                delete this._started_agents[node_name];
            });
    }
}



function create_pool_agent(req) {
    return HostedAgents.instance()
        ._start_pool_agent(req.system.pools_by_name[req.params.pool_name]);
}



function remove_pool_agent(req) {
    dbg.log0(`got params ${util.inspect(req.params)}`);
    let node_name = req.params.node_name;
    if (!node_name) {
        if (!req.params.pool_name) {
            throw new Error('remove_pool_agent missing parameters');
        }
        const pool = req.system.pools_by_name[req.params.pool_name];
        if (!pool) {
            throw new Error('could not find pool by name ' + req.params.pool_name);
        }
        node_name = 'noobaa-internal-agent-' + pool._id;
    }
    return HostedAgents.instance()
        ._stop_agent(node_name, true);
}

function _get_pool_token_wrapper(token_pool) {
    const read_token = token_key => {
        const pool_and_path = _get_pool_and_path_for_token(token_pool);
        const pool_agent_info = _.get(pool_and_path.pool, pool_and_path.pool_property_path);
        if (!pool_agent_info) throw new Error(`Pool ${token_pool.name} was not initialised`);
        return P.resolve(pool_agent_info[token_key]);
    };
    const write_token = (new_token, token_key) => {
        dbg.log1(`write_token with params: ${new_token}, ${token_key}`);
        const db_update = {
            _id: token_pool._id,
        };
        const pool_and_path = _get_pool_and_path_for_token(token_pool);
        db_update[`${pool_and_path.pool_property_path}.${token_key}`] = new_token;
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

function _get_pool_and_path_for_token(token_pool) {
    const sys = system_store.data.systems[0];
    const pool = sys.pools_by_name[token_pool.name];
    if (!pool) throw new Error(`Pool ${token_pool.name}, ${token_pool._id} does not exist`);
    const pool_property_path = pool.resource_type === 'INTERNAL' ?
        'mongo_pool_info.agent_info' : 'cloud_pool_info.agent_info';
    return {
        pool_property_path,
        pool
    };
}



// EXPORTS
exports.create_pool_agent = create_pool_agent;
exports.remove_pool_agent = remove_pool_agent;
exports.start = req => HostedAgents.instance().start();
exports.stop = req => HostedAgents.instance().stop();
exports.create_agent = req => HostedAgents.instance().start_local_agent(req.params);
exports.remove_agent = req => HostedAgents.instance()._stop_agent(req.params.name, true);

// exports.background_worker = background_worker;
