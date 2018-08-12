/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const api = require('../../api');
const pool = 'first.pool';
const crypto = require('crypto');
const ssh_functions = require('./ssh_functions');

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

async function list_nodes(server_ip) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    await client.create_auth_token(auth_params);
    const listHosts = await client.host.list_hosts({});
    const online_agents = _.flatMap(listHosts.hosts, host => host.storage_nodes_info.nodes).filter(node => node.online);
    return online_agents;
}

async function number_offline_nodes(server_ip) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    await client.create_auth_token(auth_params);
    const listHosts = await client.host.list_hosts({});
    let offline_agents = listHosts.counters.by_mode.OFFLINE;
    offline_agents = offline_agents ? offline_agents : 0;
    return offline_agents;
}

async function getTestNodes(server_ip, suffix = '') {
    const test_nodes_names = [];
    const listNods = await list_nodes(server_ip);
    for (const node of listNods) {
        if (node.name.includes(suffix)) {
            let name = node.name.split('-noobaa_storage-')[0];
            if (!name.startsWith('s3-agent')) {
                test_nodes_names.push(name);
            }
        }
    }
    if (test_nodes_names.length === 0) {
        console.log(`There are no relevant nodes.`);
    } else {
        console.log(`Relevant nodes: ${test_nodes_names}`);
    }
    return test_nodes_names;
}

async function list_optimal_agents(server_ip, suffix = '') {
    const test_optimal_nodes_names = [];
    const listNods = await list_nodes(server_ip);
    for (const node of listNods) {
        if (node.mode === 'OPTIMAL') {
            if (node.name.includes(suffix)) {
                test_optimal_nodes_names.push(node.name);
            }
        }
    }
    if (test_optimal_nodes_names.length === 0) {
        console.log(`There are no relevant nodes.`);
    } else {
        console.log(`Relevant nodes: ${test_optimal_nodes_names}`);
    }
    return test_optimal_nodes_names;
}

// Creates agent using map [agentname,agentOs]
async function createAgentsFromMap(azf, server_ip, storage, vnet, exclude_drives = [], agentmap) {
    const created_agents = [];
    const agents_to_create = Array.from(agentmap.keys());
    const agentConf = await getAgentConf(server_ip, exclude_drives);
    await P.map(agents_to_create, async name => {
        try {
            const os = await azf.getImagesfromOSname(agentmap.get(name));
            if (os.hasImage) {
                await azf.createAgentFromImage({
                    vmName: name,
                    vmSize: 'Standard_B2s',
                    storage,
                    vnet,
                    os,
                    server_ip,
                    shouldInstall: true,
                });
                created_agents.push(name);
            } else {
                await azf.createAgent({
                    vmName: name,
                    storage,
                    vnet,
                    os,
                    vmsize: 'Standard_B2s',
                    agentConf,
                    server_ip
                });
                created_agents.push(name);
            }
        } catch (e) {
            console.error(`Creating agent ${name} FAILED `, e);
        }
    });
    console.warn(`Waiting for a 2 min for agents to come up...`);
    await P.delay(120 * 1000);
    return created_agents;
}


//TODO: the if inside this function and the isInclude is for the use of agent_metrix test, need to make it work.
// function createAgents(azf, server_ip, storage, resource_vnet, isInclude, exclude_drives = [], ...oses) {
async function createAgents(azf, server_ip, storage, vnet, exclude_drives = [], suffix = '', oses) {
    console.log(`starting the create agents stage`);
    const listNods = await list_nodes(server_ip);
    const decommissioned_nodes = listNods.filter(node => node.mode === 'DECOMMISSIONED');
    console.log(`${Yellow}Number of deactivated agents: ${decommissioned_nodes.length}${NC}`);
    const Online_node_number = listNods.length - decommissioned_nodes.length;
    console.warn(`${Yellow}Num nodes before the test is: ${
                listNods.length}, ${Online_node_number} Online and ${
                decommissioned_nodes.length} deactivated.${NC}`);
    if (decommissioned_nodes.length !== 0) {
        const deactivated_nodes = decommissioned_nodes.map(node => node.name);
        console.log(`${Yellow}activating all the deactivated agents:${NC} ${deactivated_nodes}`);
        await activeAgents(server_ip, deactivated_nodes);
    }
    const agentConf = await getAgentConf(server_ip, exclude_drives);

    const test_nodes_names = await getTestNodes(server_ip, oses, suffix);
    // if (isInclude) {
    await P.map(oses, async osname => {
        try {
            await azf.createAgent({
                vmName: osname + suffix,
                storage,
                vnet,
                os: osname,
                agentConf,
                server_ip
            });
        } catch (err) {
            console.error(`Creating vm extension is FAILED `, err);
        }
    });
    // });
    //     } else {
    //         return runExtensions('init_agent', `${server_ip} ${agentConf}`)
    //             .catch(err => {
    //                 console.error(`Creating vm extension is FAILED `, err);
    //             });
    //     }

    console.warn(`Waiting for a 2 min for agents to come up...`);
    await P.delay(120 * 1000);
    await isIncluded({
        server_ip,
        previous_agent_number: test_nodes_names.length,
        additional_agents: oses.length,
        print: 'create agent',
        oses,
        suffix
    });
}

async function createAgentsWithList(params) {
    const { azf, server_ip, storage, vnet, exclude_drives, suffix, oses } = params;
    await createAgents(azf, server_ip, storage, vnet, exclude_drives, suffix, oses);
    const listNodes = await list_nodes(server_ip);
    let node_number_after_create = listNodes.length;
    console.log(`${Yellow}Num nodes after create is: ${node_number_after_create}${NC}`);
    console.warn(`Node names are ${listNodes.map(node => node.name)}`);
}

async function getAgentConfInstallString(server_ip, osType, exclude_drives = []) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    await client.create_auth_token(auth_params);
    const installationString = await client.system.get_node_installation_string({
        pool: pool,
        exclude_drives
    });
    if (osType === 'Linux') {
        return installationString.LINUX;
    } else if (osType === 'Windows') {
        return installationString.WINDOWS;
    } else {
        throw new Error(`osType is ${osType}`);
    }
}

async function getAgentConf(server_ip, exclude_drives = []) {
    const installationString = await getAgentConfInstallString(server_ip, 'Linux', exclude_drives);
    const agentConfArr = installationString.split(" ");
    return agentConfArr[agentConfArr.length - 1];
}

const agentCommandGeneratorForOS = {
    LINUX: agentCommand => `
        sudo bash -c '${agentCommand}'
    `,
    WINDOWS: agentCommand => `
        sudo bash -c '${agentCommand}'
    `
};

async function runAgentCommandViaSsh(agent_server_ip, username, password, agentCommand, osType) {
    const client = await ssh_functions.ssh_connect({
        host: agent_server_ip,
        username: username,
        password: password,
        keepaliveInterval: 5000,
    });
    //becoming root and running the agent command
    console.log(`running agent command on ${agent_server_ip}`);
    const generateOSCommand = agentCommandGeneratorForOS[osType.toUpperCase()];
    if (!generateOSCommand) throw new Error('Unknown os type: ', osType);
    await ssh_functions.ssh_exec(client, generateOSCommand(agentCommand));
}

async function activeAgents(server_ip, deactivated_nodes_list) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    await client.create_auth_token(auth_params);
    for (const name of deactivated_nodes_list) {
        console.log('calling recommission_node on', name);
        return client.node.recommission_node({ name });
    }
}

async function deactiveAgents(server_ip, activated_nodes_list) {
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    await client.create_auth_token(auth_params);
    for (const name of activated_nodes_list) {
        console.log('calling decommission_node on', name);
        await client.node.decommission_node({ name });
    }
}

async function activeAllHosts(server_ip) {
    console.log(`Active All Hosts`);
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    await client.create_auth_token(auth_params);
    const list_hosts = await client.host.list_hosts({});
    for (const names of list_hosts.filter(node => node.mode === 'DECOMMISSIONED')) {
        let params = {
            name: names.name,
            services: {
                s3: undefined,
                storage: true
            },
        };
        await client.host.update_host_services(params);
    }
}

async function deactiveAllHosts(server_ip) {
    console.log(`Deactiveing All Hosts`);
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    await client.create_auth_token(auth_params);
    const list_hosts = await client.host.list_hosts({});
    for (const names of list_hosts.hosts.filter(node => node.mode === 'OPTIMAL')) {
        let params = {
            name: names.name,
            services: {
                s3: undefined,
                storage: false
            },
        };
        await client.host.update_host_services(params);
    }
}

//check how many agents there are now, expecting agent to be included.
async function isIncluded(params) {
    console.log(params);
    const { server_ip, previous_agent_number, additional_agents, print = 'include', suffix = '' } = params;
    try {
        const listNodes = await list_nodes(server_ip);
        const decommisioned_nodes = listNodes.filter(node => node.mode === 'DECOMMISSIONED');
        console.warn(`${Yellow}Number of Excluded agents: ${decommisioned_nodes.length}${NC}`);
        console.warn(`Node names are ${listNodes.map(node => node.name)}`);
        const expected_count = previous_agent_number + additional_agents;
        const test_nodes = await list_optimal_agents(server_ip, suffix);
        const actual_count = test_nodes.length;
        if (actual_count === expected_count) {
            console.warn(`${Yellow}Number of nodes after ${print} are ${actual_count}${NC}`);
        } else {
            const error = `Number of nodes after ${print} are ${
                    actual_count} - something went wrong... expected ${expected_count}`;
            console.error(`${Yellow}${error}${NC}`);
            throw new Error(error);
        }
    } catch (err) {
        console.log('isIncluded Caught ERR', err);
        throw err;
    }
}

async function stop_agent(azf, agent) {
    try {
        console.log('Stopping agents VM ', agent);
        await azf.stopVirtualMachine(agent);
        await azf.waitMachineState(agent, 'VM stopped');
    } catch (err) {
        console.error(`FAILED stopping agent`, agent, err);
    }
}

async function start_agent(azf, agent) {
    console.log('Starting agents VM ', agent);
    try {
        await azf.startVirtualMachine(agent);
        await azf.waitMachineState(agent, 'VM running');
    } catch (err) {
        console.error(`FAILED running agent`, agent, err);
    }
}

//removes agents with names that include suffix from Noobaa server
async function deleteAgents(server_ip, suffix = '') {
    console.log(`Starting the delete agents stage`);
    const rpc = api.new_rpc('wss://' + server_ip + ':8443');
    const client = rpc.new_client({});
    await client.create_auth_token(auth_params);
    const list_hosts = await client.host.list_hosts({});
    await P.map(list_hosts.hosts, async host => {
        if (host.name.includes(suffix)) {
            console.log('deleting', host.name);
            await client.host.delete_host({ name: host.name });
        } else {
            console.log('skipping', host.name);
        }
    });
    await P.delay(120 * 1000);
    const listNods = await list_nodes(server_ip);
    console.warn(`${Yellow}Num nodes after the delete agent are ${listNods.length}${NC}`);
}

//get a list of agents that names are inculude suffix, deletes corresponding VM and agents from NooBaa server
async function clean_agents(azf, server_ip, suffix = '') {
    const testNodes = await getTestNodes(server_ip, suffix);
    await P.map(testNodes, async agentname => {
        try {
            await azf.deleteVirtualMachine(agentname);
        } catch (err) {
            console.log(`Blob ${agentname} not found - skipping. Error: `, err.message.split('\n')[0]);
        }
    });
    await deleteAgents(server_ip, suffix);
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

async function stopRandomAgents(azf, server_ip, amount, suffix, agentlist) {
    const offlineAgents = await number_offline_nodes(server_ip);
    const stopped_agents = getRandomOsesFromList(amount, agentlist);
    for (const agent of stopped_agents) {
        await stop_agent(azf, agent);
    }
    await P.delay(100 * 1000);
    const offlineAgentsAfter = await number_offline_nodes(server_ip);
    const offlineExpected = offlineAgents + amount;
    if (offlineAgentsAfter === offlineExpected) {
        console.log(`Number of offline agents is: ${offlineAgentsAfter} - as should`);
    } else {
        console.error(`Number of offline agents after stop is: ${offlineAgentsAfter}, expected: ${offlineExpected}`);
    }
    const optimal_agents = await list_optimal_agents(server_ip, suffix);
    const onlineAgents = optimal_agents.length;
    const expectedOnlineAgents = agentlist.length - amount;
    if (onlineAgents === expectedOnlineAgents) {
        console.log(`Number of online agents is: ${onlineAgents} - as should`);
    } else {
        console.error(`Number of online agents after stop is: ${onlineAgents}, expected: ${expectedOnlineAgents}`);
    }
    return stopped_agents;
}

async function waitForAgentsAmount(server_ip, numberAgents) {
    let agents;
    console.log('Waiting for server getting up all agents ' + numberAgents);
    for (let retries = 1; retries <= 36; ++retries) {
        try {
            const list = await list_nodes(server_ip);
            agents = list.length;
            if (agents === numberAgents) {
                return true;
            }
        } catch (e) {
            console.log(`Current agents number is: ${agents}, waiting 5 extra seconds for: ${numberAgents}`);
            await P.delay(5 * 1000);
        }
    }
    console.warn(`We excpected ${agents}, and got ${numberAgents}`);
    return false;
}

async function startOfflineAgents(azf, server_ip, oses) {
    let listNodes = await list_nodes(server_ip);
    const agentsExpected = listNodes.length + oses.length;
    for (const agent of oses) {
        await start_agent(azf, agent);
    }
    await waitForAgentsAmount(server_ip, agentsExpected);
    listNodes = await list_nodes(server_ip);
    const onlineAgentsOn = listNodes.length;
    if (onlineAgentsOn === agentsExpected) {
        console.log(`Number of online agents is ${onlineAgentsOn} - as expected`);
    } else {
        console.error(`We expected ${agentsExpected} online agents and got ${onlineAgentsOn}`);
    }
}

async function createRandomAgents(azf, server_ip, storage, resource_vnet, amount, suffix, oses) {
    let agentmap = new Map();
    const createdAgents = getRandomOsesFromList(amount, oses);
    for (let i = 0; i < createdAgents.length; i++) {
        agentmap.set(suffix + i, createdAgents[i]);
    }
    await createAgentsFromMap(azf, server_ip, storage, resource_vnet, [], agentmap);
    const listNodes = await list_nodes(server_ip);
    let node_number_after_create = listNodes.length;
    console.log(`${Yellow}Num nodes after create is: ${node_number_after_create}${NC}`);
    console.warn(`Node names are ${listNodes.map(node => node.name)}`);
    return agentmap;
}

/*
 * Write or remove fake local disk usage from an agent (or a server)
 * if sizeMB is supplied, will allocate a local file equal to that size
 * Otherwise will delete the previously allocated local file
 */
async function manipulateLocalDisk(params) {
    const ssh_client = await ssh_functions.ssh_connect({
        host: params.ip,
        username: 'noobaaroot',
        password: params.secret,
        keepaliveInterval: 5000,
    });
    if (params.sizeMB) {
        await ssh_functions.ssh_exec(ssh_client, `sudo bash -c "fallocate -l ${params.sizeMB}M /tmp/manipulateLocalDisk.dat"`);
    } else {
        await ssh_functions.ssh_exec(ssh_client, `sudo bash -c "rm -f /tmp/manipulateLocalDisk.dat"`);
    }
    await ssh_functions.ssh_exec(ssh_client, `sudo bash -c "sync"`);
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
