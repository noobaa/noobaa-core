/* eslint-disable header/header */
/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for
 * license information.
 */
'use strict';

const AzureFunctions = require('./azureFunctions');
const server_functions = require('../test/utils/server_functions');
const P = require('../util/promise');
const af = require('../test/utils/agent_functions'); //TODO: remove from here when Win can be copied from an image
const srv_ops = require('../test/utils/basic_server_ops');
const dbg = require('../util/debug_module')(__filename);
dbg.set_process_name('azureJs');

const _ = require('lodash');
const fs = require('fs');
const net = require('net');
const util = require('util');
const argv = require('minimist')(process.argv.slice(2));
const crypto = require('crypto');

const version_map = 'src/deploy/version_map.json';

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
    dbg.original_console();
    console.log(`
azure.js
Usage:
    --help                    Show this usage
    --help [server/agent/lg]  Show usage of the appropriate command
    server <args>             Create / destroy NooBaa servers on Azure
    agent <args>              Create / destroy NooBaa agents on Azure
    lg <args>                 Create / destroy NooBaa LGs on Azure
`);
}

function print_usage_server() {
    dbg.original_console();
    console.log(`
azure.js
Usage:
      --help server               Show this usage
      --name <name>               The name of the newly created server(s)
      --location <location>       The azure location you want to use (default: ${locationDefault})
      --resource <resource-group> The azure resource group to use
      --storage <storage-account> The azure storage account to use
      --vnet <vnet>               The azure virtual network to use
      --vmsize <vmsize>           The azure VM size to use (default: ${AzureFunctions.DEFAULT_VMSIZE})
      --servers                   How many servers to create, default is 1
      --server_version            The server base (default: latest)
      --clusterize                If the number of servers > 1, this flag will clusterize all the servers together, default is false
      --nosystem                  Skip system creation, defaults is to create one. If clusterize is turned on, a system will be created
      --setNTP                    If supplied will set NTP to local IL time and TZ. Default is off
      --upgrade                   will upgrade to the given package immediately after system creation
      \n
      Examples:
      \tnode src/deploy/azure.js server --resource nimrodb-group --storage nimrodbstorage --vnet nimrodb-group-vnet --name test1 --servers 1 --setNTP
      \t\tWould result in creating 1 new server with the name test1 with a system created and an NTP configured\n
      \tnode src/deploy/azure.js server --resource nimrodb-group --storage nimrodbstorage --vnet nimrodb-group-vnet --name test1 --servers 1 --nosystem
      \t\tWould result in creating 1 new server with the name test1 with no system and no NTP configured\n
      \tnode src/deploy/azure.js server --resource nimrodb-group --storage nimrodbstorage --vnet nimrodb-group-vnet --name cluster1 --servers 3 --clusterize
      \t\tWould result in creating 3 new servers in the names of cluster101, cluster102, cluster103 and clusterizing them\n
    `);
}

function print_usage_agent() {
    dbg.original_console();
    console.log(`
azure.js
Usage:
    --help agent                Show this usage
    --ip <noobaa-ip>            The IP of noobaa server to add agents to
    --location <location>       The azure location you want to use (default: ${locationDefault})
    --resource <resource-group> The azure resource group to use
    --storage <storage-account> The azure storage account to use
    --vnet <vnet>               The azure virtual network to use
    --vmsize <vmsize>           The azure VM size to use (default: ${AzureFunctions.DEFAULT_VMSIZE})
    --delete <agents-number>    Number of agents to delete
    --add <agents-number>       The number of agents to add
    --os <name>                 The desired os for the agent (default is centos7). Supported OS types:
                                ubuntu12/ubuntu14/ubuntu16/ubuntu18/centos6/centos7/redhat6/redhat7/win2008/win2012/win2016
    --allimages                 Creates 1 agent per each supported OSs. If the number of agents requested exceeds the number of OSs
                                duplicates would be created.
    --usemarket                 Use OS Images from the market and not prepared VHDs
    --ddisknumber <disk-number> Number of data disks to add to the agent (default: 0)
    --ddisksize <disk-size>     Size of data disks to add to the agent (default: 100GB)
    \n
    Examples:
    \tnode src/deploy/azure.js agent --resource nimrodb-group --storage nimrodbstorage --vnet nimrodb-group-vnet --ip 20.190.61.158 --add 1 --os redhat6 --usemarket
    \t\tWould result in adding 1 new agent to the server at 20.190.61.158, of type redhat6 using the market image\n
    \tnode src/deploy/azure.js agent --resource nimrodb-group --storage nimrodbstorage --vnet nimrodb-group-vnet --ip 20.190.61.158 --add 12 --allimages
    \t\tWould result in adding 12 agents, from all supported OSs (round robin). All agents will be created form the pre-prepared images if such are available\n
    \tnode src/deploy/azure.js agent --resource nimrodb-group --storage nimrodbstorage --vnet nimrodb-group-vnet --ip 20.190.61.158 --delete 2
    \t\tWould result in deleting 2 agents which are connected to the server at 20.190.61.158\n
`);
}

function print_usage_lg() {
    dbg.original_console();
    console.log(`
    Usage:
      --help lg                   show this usage
      --location <location>       the azure location you want to use (default: ${locationDefault})
      --resource <resource-group> the azure resource group to use
      --storage <storage-account> the azure storage account to use
      --vnet <vnet>               the azure virtual network to use
      --vmsize <vmsize>           The azure VM size to use (default: ${AzureFunctions.DEFAULT_VMSIZE})
      --lg_suffix <suffix>        add a suffix to the LG machine name  
    `);
}

const OSNAMES = [
    { type: 'ubuntu12', shortname: 'u12' },
    { type: 'ubuntu14', shortname: 'u14' },
    { type: 'ubuntu16', shortname: 'u16' },
    { type: 'ubuntu18', shortname: 'u18' },
    { type: 'centos6', shortname: 'c6' },
    { type: 'centos7', shortname: 'c7' },
    { type: 'redhat6', shortname: 'r6' },
    { type: 'redhat7', shortname: 'r7' },
    { type: 'win2008', shortname: 'w8' },
    { type: 'win2012', shortname: 'w2' },
    { type: 'win2016', shortname: 'w6' },
];

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

async function get_version(server_version) {
    const buf = await fs.readFileAsync(version_map);
    const ver_map = JSON.parse(buf.toString());
    for (let list = 0; list < ver_map.versions.length; ++list) {
        if (ver_map.versions[list].ver === server_version) {
            return ver_map.versions[list].vhd;
        }
    }
    throw new Error(`failed to get the ${server_version} version vhd name.`);
}

async function _runServer() {
    const serverName = argv.name;
    const numServers = argv.servers || 1;
    const setNTP = Boolean(argv.clusterize || argv.setNTP);
    const upgrade_package = argv.upgrade || undefined;
    let createSystem;
    if (argv.clusterize) {
        createSystem = true;
    } else if (argv.nosystem) {
        createSystem = false;
    } else {
        createSystem = true;
    }
    await azf.authenticate();
    let servers = [];
    for (let i = 0; i < numServers; ++i) {
        servers.push({
            name: `${serverName}0${i + 1}`,
            secret: '',
            ip: ''
        });
    }
    console.log('createSystem', createSystem);
    await P.map(servers, async server => {
        let createServerParams = {
            serverName: server.name,
            vmSize: argv.vmsize,
            vnet: argv.vnet,
            storage: argv.storage,
            createSystem: createSystem,
            updateNTP: setNTP
        };
        if (argv.server_version) {
            createServerParams.imagename = await get_version(argv.server_version);
        }
        server.secret = await azf.createServer(createServerParams);
        server.ip = await azf.getIpAddress(server.name + '_pip');
        if (createSystem && upgrade_package) {
            await srv_ops.upload_and_upgrade(server.ip, upgrade_package);
        }
        console.log(`Cluster/Server: ${serverName} was successfully created, ip is: ${server.ip}` + (server.secret ? ` secret is: ${server.secret}` : ''));
    });
    if (argv.servers > 1 && argv.clusterize) {
        console.log('Clusterizing servers');
        const slaves = Array.from(servers);
        const master = slaves.pop();
        for (const slave of slaves) {
            await server_functions.add_server_to_cluster(master.ip, slave.ip, slave.secret);
        }
    }
    console.log('Finished Server Actions Successfully');
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
                    .then(() => console.log(`Finished deleting ${machine}`))
                    .catch(err => console.log('got error on deleteVirtualMachine', err)));
            } else { //Add Agents
                const agentsPlan = agents_plan_builder(addAgents, (allimages ? 'ALL' : os), prefix, current_vms.length);
                return P.map(agentsPlan, machine => {
                    console.log(`Provisioning ${util.inspect(machine)}`);
                    return P.resolve()
                        .then(() => {
                            //TODO: remove from here when Win/redhat7 can be copied from an image 
                            if (!machine.hasimage || argv.usemarket) {
                                return af.getAgentConf(serverIP)
                                    .then(agentConf => azf.createAgent({
                                        vmName: machine.name,
                                        vmSize: argv.vmsize,
                                        storage: argv.storage,
                                        vnet: argv.vnet,
                                        os: machine.os,
                                        agentConf: agentConf,
                                        server_ip: serverIP,
                                        allocate_pip: true
                                    }));
                            } else {
                                return azf.createAgentFromImage({
                                    vmName: machine.name,
                                    vmSize: argv.vmsize,
                                    storage: argv.storage,
                                    vnet: argv.vnet,
                                    os: machine.os,
                                    server_ip: serverIP,
                                    shouldInstall: true,
                                    allocate_pip: true
                                });
                            }
                        })
                        .then(() => {
                            if (argv.ddisknumber) {
                                return azf.addDataDiskToVM({
                                        vm: machine.name,
                                        size: argv.ddisksize,
                                        storage: argv.storage,
                                        number_of_disks: argv.ddisknumber,
                                    })
                                    .then(() => azf.rescanDataDisksExtension(machine.name));
                            }
                        })
                        .then(() => console.log(`Successfully created ${util.inspect(machine)}`))
                        .catch(err => console.log('got error provisioning agent', err));
                });
            }
        })
        .then(() => console.log('Finished Agent Actions Successfully'));
}

async function _runLG() {
    const lg_suffix = argv.lg_suffix || '';
    await azf.authenticate();
    await azf.createLGFromImage({
        vmName: 'LG' + lg_suffix,
        vmSize: argv.vmsize,
        vnet: argv.vnet,
        storage: argv.storage,
    });
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
        const hasImage = azf.getImagesfromOSname(OSNAMES[curOs].type).hasImage;
        VMPlan.push({
            name: vmName,
            os: OSNAMES[curOs].type,
            hasimage: hasImage
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
