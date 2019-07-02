/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const dbg = require('../../util/debug_module')(__filename);
const kube_utils = require('../../util/kube_utils');
const string_utils = require('../../util/string_utils');
const yaml_utils = require('../../util/yaml_utils');
const Agent = require('../../agent/agent');
const uuid = require('uuid/v4');
const js_utils = require('../../util/js_utils');

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

    async delete() {
        throw new Error('Not Implemented');
    }
}

// ----------------------------------------------
// implantation of AgentPoolController over
// a k8s statefull set
// ----------------------------------------------
class ManagedStatefulSetPoolController extends PoolController {
    constructor(system_name, pool_name) {
        super(system_name, pool_name);
        this._statefulset_name = _get_statefulset_name(system_name, pool_name);
    }

    async create(agent_count, agent_install_conf, agent_profile) {
        const pool_k8s_conf = await _get_k8s_conf({
            statefulset_name: this._statefulset_name,
            agent_count,
            agent_install_conf,
            ...agent_profile
        });

        dbg.log0(`ManagedStatefulSetPoolController::create: Creating k8s resources for pool ${this.pool_name}`);
        dbg.log2(`ManagedStatefulSetPoolController::create: Pool ${this.pool_name} k8s configuration is`,
            JSON.stringify(pool_k8s_conf, null, 2));

        await kube_utils.apply_conf(pool_k8s_conf);
        return yaml_utils.stringify(pool_k8s_conf);
    }

    async scale(host_count) {
        const pod_count = (await this._list_pods()).length;
        const delta = host_count - pod_count;
        if (delta === 0) return;

        // scale the stateful set
        const { _statefulset_name } = this;
        dbg.log0(`ManagedStatefulSetPoolController::scale: scaling ${
            delta > 0 ? 'up' : 'down'
        } stateful set  ${
            _statefulset_name
        } from ${
            pod_count
        } replicas to ${
            host_count
        } replicas`);

        if (host_count > 0) {
            await kube_utils.patch_resource('StatefulSet', _statefulset_name, { spec: { replicas: host_count } });
        } else {
            await kube_utils.delete_reosurce('StatefulSet', _statefulset_name);
        }

        if (delta < 0) {
            // If we are scaling down we should also clean the pvc resource claimed by
            // the terminated pods.
            const pods = await this._list_pods();
            await Promise.all(pods
                .filter(pod => {
                    const pod_name = pod.metadata.name;
                    const pod_index = Number(pod_name.slice(pod_name.lastIndexOf('-') + 1));
                    return pod_index >= host_count;
                })
                .map(async pod => {
                    const pod_name = pod.metadata.name;

                    // Wait for the pod to be deleted.
                    dbg.log0(`ManagedStatefulSetPoolController::scale: waiting for pod ${pod_name} to be deleted`);
                    await kube_utils.wait_for_delete('pod', pod_name);

                    // Delete the pvc claimed by the pod.
                    const pvc_name = `noobaastorage-${pod_name}`;
                    dbg.log0(`ManagedStatefulSetPoolController::scale: deleting pvc ${pvc_name}`);
                    return kube_utils.delete_reosurce('pvc', pvc_name);
                })
           );
        }
    }

     async delete() {
         this.scale(0);
     }

    async _list_pods() {
        const escaped_statefulset_name = string_utils.escape_reg_exp(this._statefulset_name);
        const pod_name_regexp = new RegExp(`^${escaped_statefulset_name}-\\d+$`);
        const { items: pods } = await kube_utils.list_resources('pod', 'noobaa-module=noobaa-agent');
        return pods.filter(pod => pod_name_regexp.test(pod.metadata.name));
    }
}

// ----------------------------------------------
// An noop implantation of AgentPoolController
// should be used in environments where noobaa
// have no controll over the underlaying storage
// ----------------------------------------------
class UnmanagedStatefulSetPoolController extends PoolController {
    constructor(system_name, pool_name) {
        super(system_name, pool_name);
        this._statefulset_name = _get_statefulset_name(system_name, pool_name);
    }

    // Just return the configuration to apply in order to create
    // the statefulset.
    async create(agent_count, agent_install_conf, agent_profile) {
        const pool_k8s_conf = await _get_k8s_conf({
            statefulset_name: this._statefulset_name,
            agent_count,
            agent_install_conf,
            ...agent_profile
        });
        return yaml_utils.stringify(pool_k8s_conf);
    }

    async scale(host_count) {
        // noop (unmanaged)
    }

    async delete(host_count) {
        // noop (unmanaged)
    }
}

// ----------------------------------------------
// A implamntation which start in process agents.
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
            dbg.log0(`InProcessAgentsPoolController::scale: stoping ${agents.length - host_count} agents for deleted hosts of pool ${this.pool_name}`);
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

// ----------------------------------------------
// Shared utils
// ---------------------------------------------
function _get_statefulset_name(system_name, pool_name) {
    return `${pool_name}-${system_name}-noobaa`;
}

async function _get_k8s_conf(params) {
    const yaml_path = path.resolve(__dirname, '../../deploy/NVA_build/noobaa_pool.yaml');
    const yaml = (await fs.readFileAsync(yaml_path)).toString();
    const conf_template = await yaml_utils.parse(yaml);

     // Find the noobaa-agent stateful set.
    const statefulset = conf_template.items
        .find(resource =>
            resource.kind === 'StatefulSet' &&
            resource.metadata.name === 'noobaa-agent'
        );
    if (!statefulset) {
        throw new Error('Invalid agent template: missing StatefulSet named noobaa-agent');
    }

    // A ref to the template section.
    const { template } = statefulset.spec;

    // Find the noobaa agent container.
    const agent_container = template.spec.containers
        .find(container => container.name === 'noobaa-agent');
    if (!agent_container) {
        throw new Error('Invalid agent tempalte: missing container named noobaa-agent');
    }

    // Find/Create the agent conf env variable definition;
    const agent_conf_var = agent_container.env
        .find(env => env.name === 'AGENT_CONFIG');
    if (!agent_conf_var) {
        throw new Error('Invalid agent tempalte: missing env variable definition named AGENT_CONFIG');
    }

    // Find the valume claim tempalte.
    const volume_claim_template = statefulset.spec.volumeClaimTemplates
        .find(vct => vct.metadata.name === 'noobaastorage');
    if (!volume_claim_template) {
        throw new Error('Invalid agent tempalte: missing volume claim template named noobaastorage');
    }

    // Update the template the given configuration.
    statefulset.metadata.name = params.statefulset_name;
    statefulset.spec.replicas = params.agent_count;
    agent_container.image = params.image;
    agent_conf_var.value = params.agent_install_conf;

    if (!_.isUndefined(params.cpu)) {
        agent_container.resources.requests.cpu = params.cpu;
    }

    if (!_.isUndefined(params.memory)) {
        agent_container.resources.requests.memory = params.memory;
    }

    const { use_persistent_stroage = true } = params;
    if (use_persistent_stroage) {
        if (!_.isUndefined(params.volume_size)) {
            volume_claim_template.spec.resources.requests.storage = params.volume_size;
        }
    } else {
        //remove persistent volume claims from the statefulset
        statefulset.spec.volumeClaimTemplates = null;
        template.spec.volumes = (agent_container.volumeMounts || [])
            .map(mount => ({ name: mount.name, emptyDir: {} }));
    }

    return conf_template;
}

exports.ManagedStatefulSetPoolController = ManagedStatefulSetPoolController;
exports.UnmanagedStatefulSetPoolController = UnmanagedStatefulSetPoolController;
exports.InProcessAgentsPoolController = InProcessAgentsPoolController;
