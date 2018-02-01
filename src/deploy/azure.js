/* eslint-disable header/header */
/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for
 * license information.
 */
'use strict';

const util = require('util');
const P = require('../util/promise');
const AzureFunctions = require('./azureFunctions');
const crypto = require('crypto');
const argv = require('minimist')(process.argv.slice(2));
const net = require('net');
const _ = require('lodash');
const af = require('../test/utils/agent_functions'); //TODO: remove from here when Win can be copied from an image

const locationDefault = 'westus2';

if (argv.help) {
    if (argv.help === 'server') {
        print_usage_server();
    } else if (argv.help === 'agent') {
        print_usage_agent();
    } else if (argv.help === 'lg') {
        print_usage_lg();
    } else {
        print_usage_top_level();
    }
    process.exit(0);
}

/*
Usage Printers
*/

function print_usage_top_level() {
    console.log(`
Usage:
    --help                      Show this usage
    --help [server/agent/lg]    Show usage of the appropriate command
    server <args>             Create / destroy NooBaa servers on Azure
    agent <args>              Create / destroy NooBaa agents on Azure
    lg <args>                 Create / destroy NooBaa LGs on Azure
`);
}

function print_usage_server() {
    console.log(`
    Usage:
      --help server               Show this usage
      --name <name>               The name of the newly created server(s)
      --location <location>       The azure location you want to use (default: ${locationDefault})
      --resource <resource-group> The azure resource group to use
      --storage <storage-account> The azure storage account to use
      --vnet <vnet>               The azure virtual network to use
      --servers                   How many servers to create, default is 1
      --clusterize                If the number of servers > 1, this flag will clusterize all the servers together, default is false
      --nosystem                  Skip system creation, defaults is to create one. If clusterize is turned on, a system will be created.
    `);
}

function print_usage_agent() {
    console.log(`
    Usage:
    --help agent                Show this usage
    --ip <noobaa-ip>            The IP of noobaa server to add agents to
    --add <agents-number>       The number of agents to add
    --location <location>       The azure location you want to use (default: ${locationDefault})
    --resource <resource-group> The azure resource group to use
    --storage <storage-account> The azure storage account to use
    --vnet <vnet>               The azure virtual network to use
    --delete <agents-number>    Number of agents to delete
    --os <name>                 The desired os for the agent (default is centos7). Supported OS types:
                                ubuntu12/ubuntu14/ubuntu16/centos6/centos7/redhat6/redhat7/win2008/win2012/win2016
    --allimages                 Creates 1 agent per each supported OSs. If the number of agents requested exceeds the number of OSs
                                duplicates would be created.
    --usemarket                 Use OS Images from the market and not prepared VHDs
`);
}

function print_usage_lg() {
    console.log(`
    Usage:
      --help lg                   show this usage
      --location <location>       the azure location you want to use (default: ${locationDefault})
      --resource <resource-group> the azure resource group to use
      --storage <storage-account> the azure storage account to use
      --vnet <vnet>               the azure virtual network to use
    `);
}

const OSNAMES = [
    { type: 'ubuntu14', shortname: 'u14' },
    { type: 'ubuntu16', shortname: 'u16' },
    { type: 'ubuntu12', shortname: 'u12' },
    { type: 'centos6', shortname: 'c6' },
    { type: 'centos7', shortname: 'c7' },
    { type: 'redhat6', shortname: 'r6' },
    { type: 'redhat7', shortname: 'r7' },
    { type: 'win2008', shortname: 'w08' },
    { type: 'win2012', shortname: 'w12' },
    { type: 'win2016', shortname: 'w16' },
];

// Environment Setup
require('../util/dotenv').load();
let azf;


_validateEnvironmentVariablesAndBaseParams();
_run();

/*
Validators
*/
function _validateEnvironmentVariablesAndBaseParams() {
    const clientId = process.env.CLIENT_ID;
    const domain = process.env.DOMAIN;
    const secret = process.env.APPLICATION_SECRET;
    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

    let missing_args = '';
    //Verify ENV
    if (!process.env.CLIENT_ID) missing_args.push('\tmissing env parameter CLIENT_ID\n');
    if (!process.env.DOMAIN) missing_args.push('\tmissing env parameter DOMAIN\n');
    if (!process.env.APPLICATION_SECRET) missing_args.push('\tmissing env parameter APPLICATION_SECRET\n');

    //Verify base params supplied

    if (!argv.resource) {
        missing_args += '\t--resource <resource-group>\n';
    }
    if (!argv.storage) {
        missing_args += '\t--storage <storage-account>\n';
    }
    if (!argv.vnet) {
        missing_args += '\t--vnet <vnet>\n';
    }
    if (missing_args) {
        console.error(`Missing the following arguments to run:\n ${missing_args}`);
        process.exit(1);
    }
    if (connectionString.indexOf(argv.storage) === -1) {
        console.error('Configured connection string in .env does not match provided storage account');
        process.exit(3);
    }

    let location = argv.location || locationDefault;
    azf = new AzureFunctions(clientId, domain, secret, subscriptionId, argv.resource, location);
}

function _validateServerRun() {
    let missing_args = '';
    if (!argv.name) {
        missing_args += '\t--name <name>\n';
    }
    if (missing_args) {
        console.error(`Missing the following arguments to run:\n ${missing_args}`);
        process.exit(3);
    }
}

function _validateAgentRun() {
    let missing_args = '';
    if (!argv.ip) {
        missing_args += '\t--ip <ip>\n';
    }
    if (!argv.add && !argv.delete) {
        missing_args += '\tEither the add or delete_agents flags must be selected\n';
    }
    if (argv.add && argv.delete) {
        missing_args += '\tMust select only one of add or delete flags\n';
    }
    if (argv.allimages && argv.os) {
        missing_args += '\tMust select only one of allimages or os flags\n';
    }
    if (argv.os) {
        if (_.findIndex(OSNAMES, osn => osn.type === argv.os) === -1) {
            missing_args += `\tCould not find os ${argv.os}, please consult help for supported OS types\n`;
        }
    }
    if (missing_args) {
        console.error(`Missing the following arguments to run:\n ${missing_args}`);
        process.exit(3);
    }
}

/*
Run Flows
*/

function _run() {
    return P.resolve()
        .then(() => {
            switch (argv._[0]) {
                case 'server':
                    _validateServerRun();
                    return _runServer();
                case 'agent':
                    _validateAgentRun();
                    return _runAgent();
                case 'lg':
                    //No LG specific params
                    return _runLG();
                default:
                    console.error(`Unsupported option ${argv._[0]}`);
                    process.exit(2);
            }
        })
        .catch(err => {
            console.error('Caught ', err);
            process.exit(4);
        })
        .then(() => process.exit(0));
}

function _runServer() {
    const serverName = argv.name;
    const numServers = argv.servers || 1;
    let createSystem;
    if (argv.clusterize) {
        createSystem = true;
    } else if (argv.nosystem) {
        createSystem = false;
    } else {
        createSystem = true;
    }
    return azf.authenticate()
        .then(() => {
            let servers = [];
            for (let i = 0; i < numServers; ++i) {
                servers.push({
                    name: `${serverName}0${i + 1}`,
                    secret: '',
                    ip: ''
                });
            }
            console.log('createSystem', createSystem);
            return P.map(servers, server => azf.createServer({
                        serverName: server.name,
                        vnet: argv.vnet,
                        storage: argv.storage,
                        createSystem: createSystem
                    })
                    .then(new_secret => {
                        server.secret = new_secret;
                        return azf.getIpAddress(server.name + '_pip');
                    })
                    .then(ip => {
                        server.ip = ip;
                        return ip;
                    })
                )
                .then(() => {
                    if (argv.servers > 1 && argv.clusterize) {
                        console.log('Clusterizing servers');
                        const slaves = Array.from(servers);
                        const master = slaves.pop();
                        return P.each(slaves, slave => azf.addServerToCluster(master.ip, slave.ip, slave.secret));
                    }
                })
                .then(() => {
                    const server = servers[servers.length - 1];
                    console.log(`Cluster/Server: ${serverName} was successfuly created, ip is:${server.ip}` + (server.secret ? ` secret is: ${server.secret}` : ''));
                });
        })
        .then(() => console.log('Finished Server Actions Successfully'));
}

function _runAgent() {
    const serverIP = argv.ip;
    const removeAgents = argv.delete;
    const allimages = argv.allimages;
    const os = argv.os || 'centos7';
    const addAgents = allimages ? Math.max(argv.add, OSNAMES.length) : argv.add;

    let prefix;

    if (net.isIP(serverIP)) {
        const octets = serverIP.split(".");
        prefix = 'a' + octets[2] + '-' + octets[3];
    } else {
        prefix = 'a' + serverIP.substring(0, 7);
    }

    return azf.authenticate()
        .then(() => azf.listVirtualMachines(prefix, 'VM running'))
        .then(current_vms => {
            console.log(`Current VMs with the prefix ${prefix} which are online are ${current_vms.length}`);
            if (removeAgents) {
                console.log(`Selected to delete ${removeAgents} VMs`);
                let machines_to_del = [];
                for (let i = 0; i < removeAgents; ++i) {
                    console.log(`\t${current_vms[i]} will be deleted`);
                    machines_to_del.push(current_vms[i]);
                }
                return P.map(machines_to_del,
                    machine => azf.deleteVirtualMachine(machine)
                    .then(() => console.log(`Finsihed deleting ${machine}`))
                    .catch(err => console.log('got error on deleteVirtualMachine', err)));
            } else { //Add Agents
                const agentsPlan = agents_plan_builder(addAgents, (allimages ? 'ALL' : os), prefix, current_vms.length);
                return P.map(agentsPlan, machine => {
                    console.log(`Provisioning ${util.inspect(machine)}`);
                    return P.resolve()
                        .then(() => {
                            //TODO: remove from here when Win can be copied from an image 
                            if (machine.os.includes('win') || machine.os.includes('redhat7') || argv.usemarket) {
                                return af.getAgentConf(serverIP)
                                    .then(agentConf => azf.createAgent({
                                        vmName: machine.name,
                                        storage: argv.storage,
                                        vnet: argv.vnet,
                                        os: machine.os,
                                        agentConf: agentConf,
                                        serverIP: serverIP,
                                    }));
                            } else {
                                //TODO: when Win can be copied from an image remove the else, everything should be called with createAgentFromImage
                                return azf.createAgentFromImage({
                                    vmName: machine.name,
                                    storage: argv.storage,
                                    vnet: argv.vnet,
                                    os: machine.os,
                                    server_ip: serverIP,
                                });
                            }
                        })
                        .then(() => console.log(`Successfully created ${util.inspect(machine)}`))
                        .catch(err => console.log('got error provisioning agent', err));
                });
            }
        })
        .then(() => console.log('Finished Agent Actions Successfully'));
}

function _runLG() {
    return azf.authenticate()
        .then(() => azf.createLGFromImage({
            vmName: 'LG',
            vnet: argv.vnet,
            storage: argv.storage,
        }));
}

/* 
 * Utils
 */
function agents_plan_builder(count, os, prefix) {
    const timestamp = (Math.floor(Date.now() / 1000));
    let VMPlan = [];
    let curOs;
    if (os === 'ALL') {
        curOs = 0;
    } else {
        curOs = _.findIndex(OSNAMES, osn => osn.type === os);
    }
    for (let i = 0; i < count; i++) {
        let vmName = prefix;
        let shasum = crypto.createHash('sha1');
        shasum.update(timestamp.toString() + i);
        let dateSha = shasum.digest('hex');
        let postfix = dateSha.substring(dateSha.length - 3);
        vmName += `-${OSNAMES[curOs].shortname}-${postfix}`;
        VMPlan.push({
            name: vmName,
            os: OSNAMES[curOs].type,
        });
        if (os === 'ALL') { //if all images, round robin the os types
            curOs += 1;
            if (curOs === OSNAMES.length) {
                curOs = 0;
            }
        }
    }
    return VMPlan;
}
