/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const api = require('../../api');
const pool = 'first.pool';
const crypto = require('crypto');
const ssh_functions = require('./ssh_functions');
const promise_utils = require('../../util/promise_utils');


// Environment Setup
const shasum = crypto.createHash('sha1');
shasum.update(Date.now().toString());
const auth_params = {
    email: 'demo@noobaa.com',
    password: 'DeMo1',
    system: 'demo'
};
//define colors
const Yellow = "\x1b[33;1m";
const NC = "\x1b[0m";

function supported_oses(flavor) {
    const LINUX_FLAVORS = [
        'ubuntu12', 'ubuntu14', 'ubuntu16', 'ubuntu18',
        'centos6', 'centos7',
        'redhat6', 'redhat7'
    ];
    const WIN_FLAVORS = [
        'win2008', 'win2012', 'win2016'
    ];

    if (flavor === 'WIN') {
        return WIN_FLAVORS;
    } else if (flavor === 'LINUX') {
        return LINUX_FLAVORS;
    } else {
        return LINUX_FLAVORS.concat(WIN_FLAVORS);
    }
}

function list_nodes(server_ip) {
    let online_agents;
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
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
    return client.create_auth_token(auth_params)
        .then(() => client.host.list_hosts({})
            .then(res => {
                offline_agents = res.counters.by_mode.OFFLINE;
                offline_agents = offline_agents ? offline_agents : 0;
            }))
        .then(() => offline_agents);
}

function getTestNodes(server_ip, suffix = '') {
    let test_nodes_names = [];
    return list_nodes(server_ip)
        .then(res => _.map(res, node => {
            if (node.name.includes(suffix)) {
                let name = node.name.split('-noobaa_storage-')[0];
                if (!name.startsWith('s3-agent')) {
                    test_nodes_names.push(name);
                }
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

function list_optimal_agents(server_ip, suffix = '') {
    let test_optimal_nodes_names = [];
    return list_nodes(server_ip)
        .then(res => _.map(res, node => {
            if (node.mode === 'OPTIMAL') {
                if (node.name.includes(suffix)) {
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
// Creates agent using map [agentname,agentOs]
function createAgentsFromMap(azf, server_ip, storage, vnet, exclude_drives = [], agentmap) {
    const agents_to_create = Array.from(agentmap.keys());
    return getAgentConf(server_ip, exclude_drives)
        .then(res => {
            const agentConf = res;
            return P.map(agents_to_create, name => azf.createAgent({
                    vmName: name,
                    storage,
                    vnet,
                    os: azf.getImagesfromOSname(agentmap.get(name)),
                    vmsize: 'Standard_B2s',
                    agentConf,
                    serverIP: server_ip
                }))
                .tap(() => console.warn(`Waiting for a 2 min for agents to come up...`))
                .delay(120000)
                .catch(err => {
                    console.error(`Creating vm extension is FAILED `, err);
                });
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
                    os: osname,
                    agentConf,
                    serverIP: server_ip
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

function getAgentConfInstallString(server_ip, osType, exclude_drives = []) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(() => client.system.get_node_installation_string({
            pool: pool,
            exclude_drives
        }))
        .then(installationString => {
            if (osType === 'Linux') {
                return installationString.LINUX;
            } else if (osType === 'Windows') {
                return installationString.WINDOWS;
            } else {
                throw new Error(`osType is ${osType}`);
            }
        });
}

function getAgentConf(server_ip, exclude_drives = []) {
    return getAgentConfInstallString(server_ip, 'Linux', exclude_drives)
        .then(installationString => {
            const agentConfArr = installationString.split(" ");
            return agentConfArr[agentConfArr.length - 1];
        });
}

const agentCommandGeneratorForOS = {
    LINUX: agentCommand => `
        sudo bash -c '${agentCommand}'
    `,
    WINDOWS: agentCommand => `
        sudo bash -c '${agentCommand}'
    `
};

function runAgentCommandViaSsh(agent_server_ip, username, password, agentCommand, osType) {
    let client;
    return ssh_functions.ssh_connect({
            host: agent_server_ip,
            username: username,
            password: password,
            keepaliveInterval: 5000,
        })
        //becoming root and running the agent command
        .then(res => {
            client = res;
            console.log(`running agent command om ${agent_server_ip}`);
            const generateOSCommand = agentCommandGeneratorForOS[osType.toUpperCase()];
            if (!generateOSCommand) throw new Error('Unknown os type: ', osType);
            return ssh_functions.ssh_exec(client, generateOSCommand(agentCommand));
        });
}

function activeAgents(server_ip, deactivated_nodes_list) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(() => P.each(deactivated_nodes_list, name => {
            console.log('calling recommission_node on', name);
            return client.node.recommission_node({ name });
        }));
}

function deactiveAgents(server_ip, activated_nodes_list) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
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
    const { server_ip, previous_agent_number, additional_agents, print = 'include', suffix = '' } = params;
    let expected_count;
    return list_nodes(server_ip)
        .then(res => {
            const decommisioned_nodes = res.filter(node => node.mode === 'DECOMMISSIONED');
            console.warn(`${Yellow}Number of Excluded agents: ${decommisioned_nodes.length}${NC}`);
            console.warn(`Node names are ${res.map(node => node.name)}`);
            expected_count = previous_agent_number + additional_agents;
            return list_optimal_agents(server_ip, suffix);
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

//removes agents with names that include suffix from Noobaa server
function deleteAgents(server_ip, suffix = '') {
    console.log(`Starting the delete agents stage`);
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    return client.create_auth_token(auth_params)
        .then(() => client.host.list_hosts({}))
        .then(res => P.map(res.hosts, host => {
            if (host.name.includes(suffix)) {
                console.log('deleting', host.name);
                return client.host.delete_host({ name: host.name });
            } else {
                console.log('skipping', host.name);
            }
        }))
        .delay(120 * 1000)
        .then(() => list_nodes(server_ip))
        .then(res => {
            console.warn(`${Yellow}Num nodes after the delete agent are ${
                    res.length}${NC}`);
        });
}

//get a list of agents that names are inculude suffix, deletes corresponding VM and agents from NooBaa server
function clean_agents(azf, server_ip, suffix = '') {
    return getTestNodes(server_ip, suffix)
        .then(res => P.map(res, agentname => azf.deleteVirtualMachine(agentname)
            .catch(err => {
                console.log(`Blob ${agentname} not found - skipping. Error: `, err.message.split('\n')[0]);
            })))
        .then(() => deleteAgents(server_ip, suffix));
}

function getRandomOsesFromList(amount, oses) {
    let listforrnd = oses.slice();
    let listOses = [];
    if (amount <= oses.length) {
        for (let i = 0; i < amount; i++) {
            let rand = Math.floor(Math.random() * listforrnd.length);
            listOses.push(listforrnd[rand]);
            listforrnd.splice(rand, 1);
        }
    } else {
        for (let i = 0; i < oses.length; i++) {
            let rand = Math.floor(Math.random() * listforrnd.length);
            listOses.push(listforrnd[rand]);
            listforrnd.splice(rand, 1);
        }
        for (let i = 0; i < amount - oses.length; i++) {
            let rand = Math.floor(Math.random() * oses.length);
            listOses.push(oses[rand]);
        }
    }
    console.log('Random oses chosen oses ', listOses);
    return listOses;
}

function stopRandomAgents(azf, server_ip, amount, suffix, agentlist) {
    let offlineAgents;
    let stopped_agents = [];
    return number_offline_nodes(server_ip)
        .then(res => {
            offlineAgents = res;
            stopped_agents = getRandomOsesFromList(amount, agentlist);
            return P.each(stopped_agents, agent => stop_agent(azf, agent));
        })
        .delay(100 * 1000)
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
        .then(() => list_optimal_agents(server_ip, suffix))
        .then(res => {
            const onlineAgents = res.length;
            const expectedOnlineAgents = agentlist.length - amount;
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
            return P.each(oses, agent => start_agent(azf, agent));
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
    let agentmap = new Map();
    let createdAgents = getRandomOsesFromList(amount, oses);
    for (let i = 0; i < createdAgents.length; i++) {
        agentmap.set(suffix + i, createdAgents[i]);
    }
    return createAgentsFromMap(azf, server_ip, storage, resource_vnet, exclude_drives, agentmap)
        .then(() => list_nodes(server_ip)
            .then(res => {
                let node_number_after_create = res.length;
                console.log(`${Yellow}Num nodes after create is: ${node_number_after_create}${NC}`);
                console.warn(`Node names are ${res.map(node => node.name)}`);
                return agentmap;
            }));
}

/*
 * Write or remove fake local disk usage from an agent (or a server)
 * if sizeMB is supplied, will allocate a local file equal to that size
 * Otherwise will delete the previously allocated local file
 */
function manipulateLocalDisk(params) {
    return ssh_functions.ssh_connect({
            host: params.ip,
            username: 'noobaaroot',
            password: params.secret,
            keepaliveInterval: 5000,
        })
        .tap(ssh_client => {
            if (params.sizeMB) {
                return ssh_functions.ssh_exec(ssh_client, `sudo bash -c "fallocate -l ${params.sizeMB}M /tmp/manipulateLocalDisk.dat"`);
            } else {
                return ssh_functions.ssh_exec(ssh_client, `sudo bash -c "rm -f /tmp/manipulateLocalDisk.dat"`);
            }
        })
        .then(ssh_client => ssh_functions.ssh_exec(ssh_client, `sudo bash -c "sync"`));
}

exports.supported_oses = supported_oses;
exports.list_nodes = list_nodes;
exports.getTestNodes = getTestNodes;
exports.getAgentConf = getAgentConf;
exports.getAgentConfInstallString = getAgentConfInstallString;
exports.runAgentCommandViaSsh = runAgentCommandViaSsh;
exports.activeAgents = activeAgents;
exports.deactiveAgents = deactiveAgents;
exports.activeAllHosts = activeAllHosts;
exports.deactiveAllHosts = deactiveAllHosts;
exports.createAgentsFromMap = createAgentsFromMap;
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
exports.manipulateLocalDisk = manipulateLocalDisk;
exports.getRandomOsesFromList = getRandomOsesFromList;
