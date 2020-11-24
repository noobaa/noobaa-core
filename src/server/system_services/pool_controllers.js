/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const dbg = require('../../util/debug_module')(__filename);
const { KubeStore } = require('../kube-store.js');
const yaml = require('yamljs');
const Agent = require('../../agent/agent');
const { v4: uuid } = require('uuid');
const js_utils = require('../../util/js_utils');
const size_utils = require('../../util/size_utils');

class PoolController {
    constructor(system_name, pool_name) {
        this._system_name = system_name;
        this._pool_name = pool_name;
    }

    get system_name() {
        return this._system_name;
    }

    get pool_name() {
        return this._pool_name;
    }

    /**
     * @returns {Promise<string>}
     */
    async create(agent_count, agent_install_conf, agent_profile) {
        throw new Error('Not Implemented');
    }

    async scale(host_count) {
        throw new Error('Not Implemented');
    }

    async upgrade(image) {
        throw new Error('Not Implemented');
    }

    async delete() {
        throw new Error('Not Implemented');
    }
}

// ----------------------------------------------
// implantation of AgentPoolController over
// a k8s statefull set
// ----------------------------------------------
class ManagedStatefulSetPoolController extends PoolController {
    async create(agent_count, agent_install_conf, agent_profile) {
        const secret_k8s_conf = await _get_k8s_secret({
            pool_name: this.pool_name,
            agent_install_conf,
        });
        const pool_k8s_conf = await _get_k8s_conf({
            pool_name: this.pool_name,
            agent_count,
            agent_install_conf,
            ...agent_profile
        });

        dbg.log0(`ManagedStatefulSetPoolController::create: Creating k8s resources for pool ${this.pool_name}`);
        dbg.log2(`ManagedStatefulSetPoolController::create: Pool ${this.pool_name} k8s configuration is`,
            JSON.stringify(pool_k8s_conf, null, 2));

        await KubeStore.instance.create_secret(secret_k8s_conf);
        await KubeStore.instance.create_backingstore(pool_k8s_conf);
        const secret_yaml = yaml.stringify(secret_k8s_conf, 6, 2);
        const backstore_yaml = yaml.stringify(pool_k8s_conf, 6, 2);

        return `${secret_yaml}---\n${backstore_yaml}`;
    }

    async scale(host_count) {
        const current_host_count = await this.get_current_volume_number();
        const delta = host_count - current_host_count;
        if (delta === 0) return;

        // scale the stateful set
        dbg.log0(`ManagedStatefulSetPoolController::scale: scaling ${
            delta > 0 ? 'up' : 'down'
        } backing store set  ${
            this.pool_name
        } from ${
            current_host_count
        } replicas to ${
            host_count
        } replicas`);

        if (host_count > 0) {
            await KubeStore.instance.patch_backingstore(this.pool_name, { spec: { pvPool: { numVolumes: host_count } } });
        } else {
            await KubeStore.instance.delete_backingstore(this.pool_name);
        }
    }

    async upgrade(image) {
        // TODO: verify done in the operator
    }

    async delete() {
        this.scale(0);
    }

    async get_current_volume_number() {
        const backingstore = await KubeStore.instance.read_backingstore(this.pool_name);
        return backingstore.spec.pvPool.numVolumes;
    }
}

// ----------------------------------------------
// An noop implantation of AgentPoolController
// should be used in environments where noobaa
// have no control over the underlying storage
// ----------------------------------------------
class UnmanagedStatefulSetPoolController extends PoolController {
    // Just return the configuration to apply in order to create
    // the statefulset.
    async create(agent_count, agent_install_conf, agent_profile) {
        const secret_k8s_conf = await _get_k8s_secret({
            pool_name: this.pool_name,
            agent_install_conf,
        });
        const pool_k8s_conf = await _get_k8s_conf({
            pool_name: this.pool_name,
            agent_count,
            ...agent_profile
        });
        const secret_yaml = yaml.stringify(secret_k8s_conf, 6, 2);
        const backstore_yaml = yaml.stringify(pool_k8s_conf, 6, 2);

        return `${secret_yaml}---\n${backstore_yaml}`;
    }

    async scale(host_count) {
        // noop (unmanaged)
    }

    async upgrade(image) {
        // noop (unmanaged)
    }

    async delete(host_count) {
        // noop (unmanaged)
    }
}

// ----------------------------------------------
// A implantation which start in process agents.
// Used mainly in unit_tests.
// ----------------------------------------------

// Holds context info for each pool.
const pools_context = new Map();

class InProcessAgentsPoolController extends PoolController {
    async create(agent_count, agent_install_conf, agent_profile) {
        const { address, create_node_token } = JSON.parse(Buffer.from(agent_install_conf, 'base64').toString());
        pools_context.set(this.pool_name, {
            address,
            create_node_token,
            agents: []
        });

        await this.scale(agent_count);
        return '';
    }

    async scale(host_count) {
        const { agents, address, create_node_token } = pools_context.get(this.pool_name);
        const diff = host_count - agents.length;
        if (diff > 0) {
            dbg.log0(`InProcessAgentsPoolController::scale: starting ${diff} in process agents for pool ${this.pool_name}`);
            const new_agents = await Promise.all(js_utils.make_array(diff, i =>
                this._create_and_start_agent(`${this.pool_name}-${agents.length + i}`, address, create_node_token)
            ));

            agents.push(...new_agents);

        } else if (diff < 0) {
            dbg.log0(`InProcessAgentsPoolController::scale: stopping ${agents.length - host_count} agents for deleted hosts of pool ${this.pool_name}`);
            const agents_to_stop = agents.splice(diff);
            for (const agent of agents_to_stop) {
                agent.stop('force_close_n2n');
            }
        }
    }

    async delete() {
        if (!pools_context.has(this.pool_name)) {
            return;
        }

        await this.scale(0);
        pools_context.delete(this.pool_name);
    }

    async upgrade(image) {
        // noop (not relevant)
    }

    async _create_and_start_agent(hostname, base_address, token_template) {
        dbg.log0(`InProcessAgentsPoolController::_create_agent creating agent with hostname: ${hostname}`);
        let create_node_token = _.cloneDeep(token_template);
        let token = _.cloneDeep(token_template);
        const agent = new Agent({
            address: base_address,
            node_name: hostname,
            // passing token instead of storage_path to use memory storage
            token: token,
            token_wrapper: {
                read: () => _.cloneDeep(token),
                write: new_token => { token = _.cloneDeep(new_token); }
            },
            create_node_token_wrapper: {
                read: () => _.cloneDeep(create_node_token),
                write: new_token => { create_node_token = _.cloneDeep(new_token); }
            },
            host_id: uuid(),
            test_hostname: hostname
        });
        await agent.start();
        if (process.env.SUPPRESS_LOGS) {
            agent.suppress_logs();
        }
        return agent;
    }
}

async function _get_k8s_conf(params) {
    const yaml_path = path.resolve(__dirname, '../../deploy/NVA_build/noobaa_pool.yaml');
    const yaml_file = (await fs.promises.readFile(yaml_path)).toString();
    const backingstore = await yaml.parse(yaml_file);

    // Update the template the given configuration.
    backingstore.metadata.name = params.pool_name;
    backingstore.spec.pvPool.numVolumes = params.agent_count;
    backingstore.spec.pvPool.secret.name = `backing-store-pv-pool-${params.pool_name}`;

    const { use_persistent_storage = true } = params;
    if (use_persistent_storage) {
        if (!_.isUndefined(params.volume_size)) {
            backingstore.spec.pvPool.resources.requests.storage = translate_volume_size(params.volume_size);
        }

        if (!_.isUndefined(params.storage_class)) {
            backingstore.spec.pvPool.storageClass = params.storage_class;
        }
    }

    return backingstore;
}

async function _get_k8s_secret(params) {
    const yaml_path = path.resolve(__dirname, '../../deploy/NVA_build/noobaa_pool_secret.yaml');
    const yaml_file = (await fs.promises.readFile(yaml_path)).toString();
    const secret = await yaml.parse(yaml_file);

    // Update the template the given configuration.
    secret.metadata.name = `backing-store-pv-pool-${params.pool_name}`;
    secret.data.AGENT_CONFIG = Buffer.from(params.agent_install_conf).toString('base64');

    return secret;
}

function translate_volume_size(size) {
    return size_utils.human_size(size).replace(' ', '').replace('B', 'i');
}

exports.ManagedStatefulSetPoolController = ManagedStatefulSetPoolController;
exports.UnmanagedStatefulSetPoolController = UnmanagedStatefulSetPoolController;
exports.InProcessAgentsPoolController = InProcessAgentsPoolController;
