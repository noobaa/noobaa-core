/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const _ = require('lodash');
const crypto = require('crypto');

// Environment Setup
require('../../util/dotenv').load();
const shasum = crypto.createHash('sha1');
shasum.update(Date.now().toString());

//define colors
const Yellow = "\x1b[33;1m";
const NC = "\x1b[0m";
const pool = 'first.pool';
const api = require('../../api');
let agentConf;

function list_nodes(server_ip) {
    let online_agents;
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params)
    .then(() => P.resolve(client.host.list_hosts({}))
        .then(res => {
            online_agents = _.flatMap(res.hosts, host => host.storage_nodes_info.nodes).filter(node => node.online);
        }))
        .then(() => online_agents);
}

function number_offline_nodes(server_ip) {
    let offline_agents;
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params)
    .then(() => P.resolve(client.host.list_hosts({}))
        .then(res => {
           offline_agents = res.counters.by_mode.OFFLINE;
        }))
        .then(() => offline_agents);
}

function getTestNodes(server_ip, ...oses) {
    let test_nodes_names = [];
    return list_nodes(server_ip)
        .then(res => _.map(res, node => {
            if (_.includes(oses, node.name.split('-')[0])) {
                test_nodes_names.push(node.name);
            }
        }))
        .then(() => {
            console.log(`Relevant nodes: ${test_nodes_names}`);
            return test_nodes_names;
        });
}

function list_optimal_agents(server_ip, ...oses) {
    let test_optimal_nodes_names = [];
    return list_nodes(server_ip)
        .then(res => _.map(res, node => {
            if (node.mode === 'OPTIMAL') {
                if (_.includes(oses, node.name.split('-')[0])) {
                    test_optimal_nodes_names.push(node.name);
                }
            }
        }))
        .then(() => {
            console.log(`Relevant nodes: ${test_optimal_nodes_names}`);
            return test_optimal_nodes_names;
        });
}

function createAgents(azf, server_ip, storage, resource_vnet, ...oses) {
    let hostExternalIP = {};
    let test_nodes_names = [];
    console.log(`starting the create agents stage`);
    return list_nodes(server_ip)
        .then(res => {
            const decommissioned_nodes = res.filter(node => node.mode === 'DECOMMISSIONED');
            console.log(`${Yellow}Number of deactivated agents: ${decommissioned_nodes.length}${NC}`);
            const Online_node_number = res.length - decommissioned_nodes.length;
            console.warn(`${Yellow}Num nodes before the test is: ${
                res.length}, ${Online_node_number} Online and ${
                decommissioned_nodes.length} deactivated.${NC}`);
            if (decommissioned_nodes.length !== 0) {
                const deactivated_nodes = decommissioned_nodes.map(node => node.name);
                console.log(`${Yellow}activating all the deactivated agents:${NC} ${deactivated_nodes}`);
                activeAgents(server_ip, deactivated_nodes);
            }
        })
        .then(getTestNodes(server_ip, ...oses))
        .then(res => test_nodes_names)
        .then(() => P.map(oses, osname => azf.createAgent(
            osname, storage, resource_vnet,
            azf.getImagesfromOSname(osname), server_ip, agentConf)
                .then(() => {
                    //get IP
                    let ip;
                    hostExternalIP[osname] = ip;
                })
            )
            .catch(err => {
                console.error(`Creating vm extension is FAILED `, err);
            }))
        .tap(() => console.warn(`Waiting for a 2 min for agents to come up...`))
        .delay(120000)
        .then(() => isIncluded(server_ip, test_nodes_names.length, oses.length, 'create agent', ...oses));
}

function getAgentConf(server_ip) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params)
        .then(() => client.system.get_node_installation_string({
        pool: pool,
        exclude_drives: []
    }))
        .then(installationString => {
            agentConf = installationString.LINUX;
            const index = agentConf.indexOf('config');
            agentConf = agentConf.substring(index + 7);
            console.log(agentConf);
        });
}

function create_agents(azf, server_ip, storage, resource_vnet, ...oses) {
        return getAgentConf(server_ip)
        .then(() => createAgents(azf, server_ip, storage, resource_vnet, ...oses))
        .then(() => list_nodes(server_ip)
            .then(res => {
                let node_number_after_create = res.length;
                console.log(`${Yellow}Num nodes after create is: ${node_number_after_create}${NC}`);
                console.warn(`Node names are ${res.map(node => node.name)}`);
            }));
}

function activeAgents(server_ip, deactivated_nodes_list) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params)
        .then(() => P.each(deactivated_nodes_list, name => {
        console.log('calling recommission_node on', name);
        return client.node.recommission_node({ name });
    }));
}

//check how many agents there are now, expecting agent to be included.
function isIncluded(server_ip, previous_agent_number, additional_agents, print = 'include', ...oses) {
    let expected_count;
    return list_nodes(server_ip)
        .then(res => {
            const decommisioned_nodes = res.filter(node => node.mode === 'DECOMMISSIONED');
            console.warn(`${Yellow}Number of Excluded agents: ${decommisioned_nodes.length}${NC}`);
            console.warn(`Node names are ${res.map(node => node.name)}`);
            expected_count = previous_agent_number + additional_agents;
            return list_optimal_agents(server_ip, ...oses);
        })
        .then(test_nodes => {
            const actual_count = test_nodes.length;
            if (actual_count === expected_count) {
                console.warn(`${Yellow}Num nodes after ${print} are ${actual_count}${NC}`);
            } else {
                const error = `Num nodes after ${print} are ${
                    actual_count
                    } - something went wrong... expected ${
                    expected_count
                    }`;
                console.error(`${Yellow}${error}${NC}`);
                throw new Error(error);
            }
        });
}
function stop_agent(azf, agent) {
    console.log('Stopping agents VM ', agent);
    return azf.stopVirtualMachine(agent)
        .then(() => azf.waitMachineState(agent, 'VM stopped'))
        .catch(err => {
            console.error(`FAILED stopping agent`, agent, err);
        });
}

function start_agent(azf, agent) {
    console.log('Starting agents VM ', agent);
    return azf.startVirtualMachine(agent)
        .then(() => azf.waitMachineState(agent, 'VM running'))
        .catch(err => {
            console.error(`FAILED running agent`, agent, err);
        });
}

function clean_agents(azf, ...oses) {
    return P.map(oses, osname => azf.deleteVirtualMachine(osname)
        .catch(err => {
            console.log(`${osname} not found - skipping...`, err);
        }))
        .then(() => P.map(oses, osname => azf.deleteVirtualMachine(osname, 'osdisks')
            .catch(err => {
                console.log(`Blob ${osname} not found - skipping...`, err);
            })));
}
exports.create_agents = create_agents;
exports.clean_agents = clean_agents;
exports.list_nodes = list_nodes;
exports.number_offline_agents = number_offline_nodes;
exports.list_optimal_agents = list_optimal_agents;
exports.stop_agent = stop_agent;
exports.start_agent = start_agent;
