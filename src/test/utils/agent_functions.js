/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const api = require('../../api');
const crypto = require('crypto');

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

class AgentFunctions {

    constructor(client) {
        this._client = client;
    }

    async list_nodes(mgmt_ip, mgmt_port_https) {
        const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
        const client = rpc.new_client({});
        await client.create_auth_token(auth_params);
        const listHosts = await client.host.list_hosts({});
        const online_agents = _.flatMap(listHosts.hosts, host => host.storage_nodes_info.nodes).filter(node => node.online);
        return online_agents;
    }

    async number_offline_nodes(mgmt_ip, mgmt_port_https) {
        const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
        const client = rpc.new_client({});
        await client.create_auth_token(auth_params);
        const listHosts = await client.host.list_hosts({});
        let offline_agents = listHosts.counters.by_mode.OFFLINE;
        offline_agents = offline_agents ? offline_agents : 0;
        return offline_agents;
    }

    async getTestNodes(mgmt_ip, mgmt_port_https, suffix = '') {
        const test_nodes_names = [];
        const listNods = await this.list_nodes(mgmt_ip, mgmt_port_https);
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

    async list_optimal_agents(mgmt_ip, mgmt_port_https, suffix = '') {
        const test_optimal_nodes_names = [];
        const listNods = await this.list_nodes(mgmt_ip, mgmt_port_https);
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

    async get_agents_yaml(mgmt_ip, mgmt_port_https, pool, rpc_hint = 'EXTERNAL') {
        const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, rpc_hint);
        const client = rpc.new_client({});
        await client.create_auth_token(auth_params);
        const installationString = await client.system.get_node_installation_string({
            pool: pool,
            exclude_drives: []
        });
        return installationString.KUBERNETES;
    }

    async deactivateAgents(mgmt_ip, mgmt_port_https, activated_nodes_list) {
        const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
        const client = rpc.new_client({});
        await client.create_auth_token(auth_params);
        for (const name of activated_nodes_list) {
            console.log('calling decommission_node on', name);
            await client.node.decommission_node({ name });
        }
    }

    async activeAllHosts(mgmt_ip, mgmt_port_https) {
        console.log(`Active All Hosts`);
        const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
        const client = rpc.new_client({});
        await client.create_auth_token(auth_params);
        const listHosts = await client.host.list_hosts({});
        for (const names of listHosts.hosts.filter(node => node.mode === 'DECOMMISSIONED')) {
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

    async deactivateAllHosts(mgmt_ip, mgmt_port_https) {
        console.log(`Deactivating All Hosts`);
        const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
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
    async isIncluded(params) {
        console.log(params);
        const { mgmt_ip, mgmt_port_https, previous_agent_number = 0, additional_agents = 0, print = 'include', suffix = '' } = params;
        try {
            let retry = 0;
            let actual_count;
            const expected_count = previous_agent_number + additional_agents;
            do {
                retry += 1;
                if (retry !== 1) {
                    console.log(`sleeping for 1 min`);
                    await P.delay(60 * 1000);
                }
                const listNodes = await this.list_nodes(mgmt_ip, mgmt_port_https);
                const decommissioned_nodes = listNodes.filter(node => node.mode === 'DECOMMISSIONED');
                console.warn(`${Yellow}Number of Excluded agents: ${decommissioned_nodes.length}${NC}`);
                console.warn(`Node names are ${listNodes.map(node => node.name)}`);
                const test_nodes = await this.list_optimal_agents(mgmt_ip, mgmt_port_https, suffix);
                actual_count = test_nodes.length;
            } while ((actual_count !== expected_count) && (retry < 5));
            if (actual_count === expected_count) {
                console.warn(`${Yellow}Number of nodes after ${print} are ${actual_count}${NC}`);
            } else {
                const error = `Number of nodes after ${print} are ${
                    actual_count} - something went wrong... expected ${expected_count}`;
                console.error(`${Yellow}${error}${NC}`);
                throw new Error(error);
            }
        } catch (err) {
            console.log('isIncluded Caught ERR: ', err);
            throw err;
        }
    }

    //removes agents with names that include suffix from Noobaa server
    async deleteAgents(mgmt_ip, mgmt_port_https, suffix = '') {
        console.log(`Starting the delete agents stage`);
        const rpc = api.new_rpc_from_base_address(`wss://${mgmt_ip}:${mgmt_port_https}`, 'EXTERNAL');
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
        const listNods = await this.list_nodes(mgmt_ip, mgmt_port_https);
        console.warn(`${Yellow}Num nodes after the delete agent are ${listNods.length}${NC}`);
    }

    async stopRandomAgents(azf, mgmt_ip, mgmt_port_https, amount, suffix, agentList) {
        await this.number_offline_nodes(mgmt_ip, mgmt_port_https);
        throw new Error('DEPRECATED - this flow is not relevant anymore');
        // const stopped_agents = getRandomOsesFromList(amount, agentList);
        // for (const agent of stopped_agents) {
        //     await stop_agent(azf, agent);
        // }
        // await P.delay(100 * 1000);
        // const offlineAgentsAfter = await number_offline_nodes(mgmt_ip, mgmt_port_https);
        // const offlineExpected = offlineAgents + amount;
        // if (offlineAgentsAfter === offlineExpected) {
        //     console.log(`Number of offline agents is: ${offlineAgentsAfter} - as should`);
        // } else {
        //     console.error(`Number of offline agents after stop is: ${offlineAgentsAfter}, expected: ${offlineExpected}`);
        // }
        // const optimal_agents = await list_optimal_agents(mgmt_ip, mgmt_port_https, suffix);
        // const onlineAgents = optimal_agents.length;
        // const expectedOnlineAgents = agentList.length - amount;
        // if (onlineAgents === expectedOnlineAgents) {
        //     console.log(`Number of online agents is: ${onlineAgents} - as should`);
        // } else {
        //     console.error(`Number of online agents after stop is: ${onlineAgents}, expected: ${expectedOnlineAgents}`);
        // }
        // return stopped_agents;
    }

    async waitForAgentsAmount(mgmt_ip, mgmt_port_https, numberAgents) {
        let agents;
        console.log('Waiting for server getting up all agents ' + numberAgents);
        for (let retries = 1; retries <= 36; ++retries) {
            try {
                const list = await this.list_nodes(mgmt_ip, mgmt_port_https);
                agents = list.length;
                if (agents === numberAgents) {
                    return true;
                }
            } catch (e) {
                console.log(`Current agents number is: ${agents}, waiting 5 extra seconds for: ${numberAgents}`);
                await P.delay(5 * 1000);
            }
        }
        console.warn(`We expected ${agents}, and got ${numberAgents}`);
        return false;
    }

}

exports.AgentFunctions = AgentFunctions;
