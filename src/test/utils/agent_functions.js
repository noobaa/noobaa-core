/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const _ = require('lodash');
const crypto = require('crypto');
const pool = 'first.pool';
const api = require('../../api');
const promise_utils = require('../../util/promise_utils');

// Environment Setup
require('../../util/dotenv').load();
const shasum = crypto.createHash('sha1');
shasum.update(Date.now().toString());

//define colors
const Yellow = "\x1b[33;1m";
const NC = "\x1b[0m";

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
        .then(() => client.host.list_hosts({})
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
        .then(() => client.host.list_hosts({})
            .then(res => {
                offline_agents = res.counters.by_mode.OFFLINE;
            }))
        .then(() => offline_agents);
}

function getTestNodes(server_ip, oses, suffix = '') {
    let test_nodes_names = [];
    return list_nodes(server_ip)
        .then(res => _.map(res, node => {
            if (_.includes(oses.map(os => os + suffix), node.name.split('-')[0])) {
                test_nodes_names.push(node.name);
            }
        }))
        .then(() => {
            if (test_nodes_names.length === 0) {
                console.log(`There are no relevant nodes.`);
            } else {
                console.log(`Relevant nodes: ${test_nodes_names}`);
            }
            return test_nodes_names;
        });
}

function list_optimal_agents(server_ip, oses, suffix = '') {
    let test_optimal_nodes_names = [];
    return list_nodes(server_ip)
        .then(res => _.map(res, node => {
            if (node.mode === 'OPTIMAL') {
                if (_.includes(oses.map(os => os + suffix), node.name.split('-')[0])) {
                    test_optimal_nodes_names.push(node.name);
                }
            }
        }))
        .then(() => {
            if (test_optimal_nodes_names.length === 0) {
                console.log(`There are no relevant nodes.`);
            } else {
                console.log(`Relevant nodes: ${test_optimal_nodes_names}`);
            }
            return test_optimal_nodes_names;
        });
}

//TODO: the if inside this function and the isInclude is for the use of agent_metrix test, need to make it work.
// function createAgents(azf, server_ip, storage, resource_vnet, isInclude, exclude_drives = [], ...oses) {
function createAgents(azf, server_ip, storage, vnet, exclude_drives = [], suffix = '', oses) {
    let test_nodes_names = [];
    let agentConf;
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
        .then(() => getAgentConf(server_ip, exclude_drives))
        .then(res => {
            agentConf = res;
            return getTestNodes(server_ip, oses, suffix);
        })
        .then(res => {
            test_nodes_names = res;
            // if (isInclude) {
            return P.map(oses, osname => azf.createAgent({
                vmName: osname + suffix,
                storage,
                vnet,
                os: azf.getImagesfromOSname(osname),
                serverName: server_ip,
                agentConf
            }))
                .catch(err => {
                    console.error(`Creating vm extension is FAILED `, err);
                });
            // });
            //     } else {
            //         return runExtensions('init_agent', `${server_ip} ${agentConf}`)
            //             .catch(err => {
            //                 console.error(`Creating vm extension is FAILED `, err);
            //             });
            //     }
        })
        .tap(() => console.warn(`Waiting for a 2 min for agents to come up...`))
        .delay(120000)
        .then(() => isIncluded({
            server_ip,
            previous_agent_number: test_nodes_names.length,
            additional_agents: oses.length,
            print: 'create agent',
            oses,
            suffix
        }));
}

function createAgentsWithList(params) {
    const { azf, server_ip, storage, vnet, exclude_drives, suffix, oses } = params;
    return createAgents(azf, server_ip, storage, vnet, exclude_drives, suffix, oses)
        .then(() => list_nodes(server_ip)
            .then(res => {
                let node_number_after_create = res.length;
                console.log(`${Yellow}Num nodes after create is: ${node_number_after_create}${NC}`);
                console.warn(`Node names are ${res.map(node => node.name)}`);
            }));
}

function getAgentConf(server_ip, exclude_drives = []) {
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
            exclude_drives
        }))
        .then(installationString => {
            const agentConfArr = installationString.LINUX.split(" ");
            return agentConfArr[agentConfArr.length - 1];
        });
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

function deactiveAgents(server_ip, activated_nodes_list) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params)
        .then(() => P.each(activated_nodes_list, name => {
            console.log('calling decommission_node on', name);
            return client.node.decommission_node({ name });
        }));
}

function activeAllHosts(server_ip) {
    console.log(`Active All Hosts`);
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params)
        .then(() => client.host.list_hosts({}))
        .then(res => P.each(res.hosts.filter(node => node.mode === 'DECOMMISSIONED'), names => {
            let params = {
                name: names.name,
                services: {
                    s3: undefined,
                    storage: true
                },
            };
            return client.host.update_host_services(params);
        }));
}

function deactiveAllHosts(server_ip) {
    console.log(`Deactiveing All Hosts`);
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params)
        .then(() => client.host.list_hosts({}))
        .then(res => P.each(res.hosts.filter(node => node.mode === 'OPTIMAL'), names => {
            let params = {
                name: names.name,
                services: {
                    s3: undefined,
                    storage: false
                },
            };
            return client.host.update_host_services(params);
        }));
}

//check how many agents there are now, expecting agent to be included.
function isIncluded(params) {
    console.log(params);
    const { server_ip, previous_agent_number, additional_agents, print = 'include', oses, suffix = '' } = params;
    let expected_count;
    return list_nodes(server_ip)
        .then(res => {
            const decommisioned_nodes = res.filter(node => node.mode === 'DECOMMISSIONED');
            console.warn(`${Yellow}Number of Excluded agents: ${decommisioned_nodes.length}${NC}`);
            console.warn(`Node names are ${res.map(node => node.name)}`);
            expected_count = previous_agent_number + additional_agents;
            return list_optimal_agents(server_ip, oses, suffix);
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
        })
        .catch(err => {
            console.log('isIncluded Caught ERR', err);
            throw err;
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

function deleteAgents(azf, oses, suffix = '') {
    return P.map(oses, osname => azf.deleteVirtualMachine(osname + suffix)
        .catch(err => {
            console.warn(`${osname}${suffix} not found - skipping. Error: `, err.message.split('\n')[0]);
        }));
}

function clean_agents(azf, oses, suffix = '') {
    return deleteAgents(azf, oses, suffix)
        .then(() => P.map(oses, osname => azf.deleteVirtualMachine(osname + suffix, 'osdisks')
            .catch(err => {
                console.log(`Blob ${osname}${suffix} not found - skipping. Error: `, err.message.split('\n')[0]);
            })));
}

function getRandomOsesFromList(amount, oses) {
    let listOses = [];
    for (let i = 0; i < amount; i++) {
        let rand = Math.floor(Math.random() * oses.length);
        listOses.push(oses[rand]);
        oses.splice(rand, 1);
    }
    console.log('Random oses chosen oses ', listOses);
    return listOses;
}

function stopRandomAgents(azf, server_ip, amount, suffix, oses) {
    let offlineAgents;
    let stopped_agents = [];
    return number_offline_nodes(server_ip)
        .then(res => {
            offlineAgents = res;
            stopped_agents = getRandomOsesFromList(amount, oses);
            return P.each(stopped_agents, agent => stop_agent(azf, agent + suffix));
        })
        .then(() => number_offline_nodes(server_ip))
        .then(res => {
            const offlineAgentsAfter = res;
            const offlineExpected = offlineAgents + amount;
            if (offlineAgentsAfter === offlineExpected) {
                console.log(`Number of offline agents is: ${offlineAgentsAfter} - as should`);
            } else {
                console.error(`Number of offline agents after stop is: ${offlineAgentsAfter}, expected: ${offlineExpected}`);
            }
        })
        .then(() => list_optimal_agents(server_ip, oses, suffix))
        .then(res => {
            const onlineAgents = res.length;
            const expectedOnlineAgents = oses.length - amount;
            if (onlineAgents === expectedOnlineAgents) {
                console.log(`Number of online agents is: ${onlineAgents} - as should`);
            } else {
                console.error(`Number of online agents after stop is: ${onlineAgents}, expected: ${expectedOnlineAgents}`);
            }
            return stopped_agents;
        });
}

function waitForAgentsAmount(server_ip, numberAgents) {
    let agents;
    let retries = 0;
    console.log('Waiting for server getting up all agents ' + numberAgents);
    return promise_utils.pwhile(
        () => agents !== numberAgents && retries !== 36,
        () => P.resolve(list_nodes(server_ip))
            .then(res => {
                if (res) {
                    agents = res.length;
                } else {
                    retries += 1;
                    console.log('Current agents : ' + agents + ' waiting for: ' + numberAgents + ' - will wait for extra 5 seconds');
                }
            })
            .delay(5000));
}

function startOfflineAgents(azf, server_ip, suffix, oses) {
    let agentsExpected;
    return list_nodes(server_ip)
        .then(res => {
            agentsExpected = res.length + oses.length;
            return P.each(oses, agent => start_agent(azf, agent + suffix));
        })
        .then(() => waitForAgentsAmount(server_ip, agentsExpected))
        .then(() => list_nodes(server_ip))
        .then(res => {
            let onlineAgentsOn = res.length;
            if (onlineAgentsOn === agentsExpected) {
                console.log('Number of online agents is ', onlineAgentsOn, ' - as should');
            } else {
                console.error('After switching on agents number online is ' + onlineAgentsOn + ' instead ', agentsExpected);
            }
        });
}

function createRandomAgents(azf, server_ip, storage, resource_vnet, amount, suffix, oses) {
    let exclude_drives = [];
    let createdAgents = getRandomOsesFromList(amount, oses);
    return createAgents(azf, server_ip, storage, resource_vnet, exclude_drives, suffix, createdAgents)
        .then(() => list_nodes(server_ip)
            .then(res => {
                let node_number_after_create = res.length;
                console.log(`${Yellow}Num nodes after create is: ${node_number_after_create}${NC}`);
                console.warn(`Node names are ${res.map(node => node.name)}`);
                return createdAgents;
            }));
}

exports.list_nodes = list_nodes;
exports.getTestNodes = getTestNodes;
exports.getAgentConf = getAgentConf;
exports.activeAgents = activeAgents;
exports.deactiveAgents = deactiveAgents;
exports.activeAllHosts = activeAllHosts;
exports.deactiveAllHosts = deactiveAllHosts;
// exports.create_agents = create_agents;
exports.deleteAgents = deleteAgents;
exports.clean_agents = clean_agents;
exports.number_offline_agents = number_offline_nodes;
exports.list_optimal_agents = list_optimal_agents;
exports.stop_agent = stop_agent;
exports.start_agent = start_agent;
exports.createAgents = createAgents;
exports.isIncluded = isIncluded;
exports.createAgentsWithList = createAgentsWithList;
exports.createRandomAgents = createRandomAgents;
exports.stopRandomAgents = stopRandomAgents;
exports.startOfflineAgents = startOfflineAgents;
