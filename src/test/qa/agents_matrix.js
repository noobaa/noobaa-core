/* Copyright (C) 2016 NooBaa */
'use strict';

var P = require('../../util/promise');
const _ = require('lodash');
var AzureFunctions = require('../../deploy/azureFunctions');
var crypto = require('crypto');
const s3ops = require('../qa/s3ops');
const ops = require('../system_tests/basic_server_ops');

// Environment Setup
require('../../util/dotenv').load();
var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
var shasum = crypto.createHash('sha1');
shasum.update(Date.now().toString());

// Sample Config
var argv = require('minimist')(process.argv);
console.log(argv);
const location = argv.location || 'westus2';
var resourceGroupName = argv.resource;
var storageAccountName = argv.storage;
var vnetName = argv.vnet;
const serverName = argv.server_ip;
const upgrade_pack = argv.upgrade_pack;

//noobaa rpc
var api = require('../../api');
var rpc = api.new_rpc('wss://' + serverName + ':8443');
rpc.disable_validation();
var client = rpc.new_client({});
const oses = [
    'ubuntu12', 'ubuntu14', 'ubuntu16',
    'centos6', 'centos7',
    'redhat6', 'redhat7',
    'win2008', 'win2012', 'win2016'
];

const size = 16; //size in GB
let nodes = [];
let errors = [];
let agentConf;
let node_number_after_create;
let initial_node_number;

var azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resourceGroupName, location);

function saveErrorAndResume(err) {
    errors.push(err.message);
}

function createAgents(isInclude) {
    console.log(`starting the create agents stage`);
    return P.resolve(client.node.list_nodes({
        query: {
            online: true,
            skip_cloud_nodes: true,
            skip_mongo_nodes: true
        }
    }))
        .then(res => {
            initial_node_number = res.total_count;
            console.log(`Num nodes before the test is: ${initial_node_number}`);
        })
        .then(() => {
            if (isInclude) {
                return P.map(oses, osname => azf.createAgent(
                    osname, storageAccountName, vnetName,
                    azf.getImagesfromOSname(osname), serverName, agentConf
                ).catch(saveErrorAndResume));

            } else {
                return runExtensions('init_agent', `${serverName}  ${agentConf}`)
                    .catch(saveErrorAndResume);
            }
        })
        .then(() => console.warn(`Will now wait for a 2 min for agents to come up...`))
        .delay(120000)
        .then(() => isIncluded(initial_node_number, oses.length, 'create agent'));
}

function runCreateAgents(isInclude) {
    if (!argv.skipsetup) {
        return createAgents(isInclude);
    }
    return P.resolve(client.node.list_nodes({
        query: {
            online: true,
            skip_cloud_nodes: true,
            skip_mongo_nodes: true
        }
    })).then(res => {
        node_number_after_create = res.total_count;
        console.log('Num nodes after create is: ', node_number_after_create);
        nodes = [];
        console.warn(`Node names are ${res.nodes.map(node => node.name)}`);
    });
}


function verifyAgent() {
    console.log(`starting the verify agents stage`);
    return s3ops.put_file_with_md5(serverName, 'files', '100MB_File', 100)
        .then(() => s3ops.get_file_check_md5(serverName, 'files', '100MB_File'))
        // .then(() => {
        //     console.warn(`Will take diagnostics from all the agents`);
        //     return P.map(nodes, name => client.node.collect_agent_diagnostics({ name })
        //         .catch(saveErrorAndResume));
        // })
        .then(() => {
            console.warn(`Will put all agents in debug mode`);
            return P.map(nodes, name => client.node.set_debug_node({
                node: {
                    name
                },
                level: 5,
            }).catch(saveErrorAndResume));
        });
}

function runExtensions(script_name, flags = '') {
    return P.map(oses, osname => azf.deleteVirtualMachineExtension(osname)
        .catch(err => console.log(err.message)))
        .then(() => P.map(oses, osname => {
            console.log(`running extention: ${script_name}`);
            var extension = {
                publisher: 'Microsoft.OSTCExtensions',
                virtualMachineExtensionType: 'CustomScriptForLinux', // it's a must - don't beleive Microsoft
                typeHandlerVersion: '1.5',
                autoUpgradeMinorVersion: true,
                settings: {
                    fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/" + script_name + ".sh"],
                    commandToExecute: 'bash ' + script_name + '.sh ' + flags
                },
                protectedSettings: {
                    storageAccountName: "pluginsstorage",
                    storageAccountKey: "bHabDjY34dXwITjXEasmQxI84QinJqiBZHiU+Vc1dqLNSKQxvFrZbVsfDshPriIB+XIaFVaQ2R3ua1YMDYYfHw=="
                },
                location: location,
            };
            var os = azf.getImagesfromOSname(osname);
            if (os.osType === 'Windows') {
                extension.publisher = 'Microsoft.Compute';
                extension.virtualMachineExtensionType = 'CustomScriptExtension';
                extension.typeHandlerVersion = '1.7';
                extension.settings = {
                    fileUris: ["https://pluginsstorage.blob.core.windows.net/agentscripts/" + script_name + ".ps1"],
                    commandToExecute: 'powershell -ExecutionPolicy Unrestricted -File ' + script_name + '.ps1 ' + flags
                };
            }
            return azf.createVirtualMachineExtension(osname, extension)
                .catch(saveErrorAndResume);
        }));
}

function upgradeAgent() {
    console.log('starting the upgrade agents stage');
    return runExtensions('replace_version_on_agent')
        .then(() => client.system.read_system({})
            .then(result => ops.upload_and_upgrade(serverName, upgrade_pack))
            .then(() => {
                console.log(`Upgrade successful, waiting on agents to upgrade`);
                return ops.wait_on_agents_upgrade(serverName);
            }));
}

function deleteAgent() {
    console.log(`starting the delete agents stage`);
    return runExtensions('remove_agent')
        .delay(60000)
        .then(() => P.resolve(client.node.list_nodes({
            query: {
                online: true,
                skip_cloud_nodes: true,
                skip_mongo_nodes: true
            }
        })))
        .then(res => {
            nodes = [];
            console.warn(`Node names are ${res.nodes.map(node => node.name)}`);
            if (res.total_count === initial_node_number) {
                console.warn(`Num nodes after the delete agent are ${
                    res.total_count
                    } - the same as before - good`);
            } else {
                const error = `Num nodes after the delete agent are ${
                    res.total_count
                    } - something went wrong... suppose to go back to initial size ${
                    initial_node_number
                    }`;
                console.error(error);
                throw new Error(error);
            }
        });
}

function addDisksToMachine(diskSize) {
    console.log(`adding disks to the agents machine`);
    return P.map(oses, osname => {
        console.log(`adding data disk to vm ${osname} of size ${diskSize}`);
        return azf.addDataDiskToVM(osname, diskSize, storageAccountName);
    });
}

function getAgentConf(exclude_drives) {
    return client.system.get_node_installation_string({
        pool: "first.pool",
        exclude_drives
    })
        .then(installationString => {
            agentConf = installationString.LINUX;
            const index = agentConf.indexOf('config');
            agentConf = agentConf.substring(index + 7);
            console.log(agentConf);
        });
}

function checkIncludeDisk() {
    let number_befor_adding_disks;
    return P.resolve(client.node.list_nodes({
        query: {
            online: true,
            skip_cloud_nodes: true,
            skip_mongo_nodes: true
        }
    }))
        .then(res => {
            number_befor_adding_disks = res.total_count;
            console.log(`Num nodes before adding disks is: ${number_befor_adding_disks}`);
        })
        .then(() => addDisksToMachine(size))
        //map the disks
        .then(() => runExtensions('map_new_disk'))
        .delay(120000)
        .then(() => isIncluded(number_befor_adding_disks));
}

function checkExcludeDisk(excludeList) {
    let number_befor_adding_disks;
    return P.resolve(client.node.list_nodes({
        query: {
            online: true,
            skip_cloud_nodes: true,
            skip_mongo_nodes: true
        }
    }))
        .then(res => {
            number_befor_adding_disks = res.total_count;
            console.log(`Num nodes before adding disks is: ${number_befor_adding_disks}`);
        })
        .then(() => addDisksToMachine(size))
        .then(() => runExtensions('map_new_disk', '-e'))
        .then(() => isExcluded(excludeList))
        .then(() => addDisksToMachine(15))
        .then(() => runExtensions('map_new_disk'))
        .then(() => isIncluded(number_befor_adding_disks, 0))
        .then(() => runExtensions('map_new_disk'))
        .then(() => isIncluded(number_befor_adding_disks));
}

//check how many agents there are now, expecting agent to be included.
function isIncluded(previous_agent_number, additional_agents = oses.length, print = 'include') {
    return P.resolve(client.node.list_nodes({
        query: {
            online: true,
            skip_cloud_nodes: true,
            skip_mongo_nodes: true
        }
    }))
        .then(res => {
            const my_nodes = res.nodes.filter(node => node.mode === 'DECOMMISSIONED');
            console.warn(`Number of Excluded agents: ${my_nodes.length}`);
            console.warn(`Node names are ${res.nodes.map(node => node.name)}`);
            const excpected_count = previous_agent_number + additional_agents;
            const actual_count = res.total_count - my_nodes.length;
            if (actual_count === excpected_count) {
                console.warn(`Num nodes after the ${print} are ${actual_count}`);
            } else {
                const error = `Num nodes after the ${print} are ${
                    actual_count
                    } - something went wrong... expected ${
                    excpected_count
                    }`;
                console.error(error);
                throw new Error(error);
            }
        });
}

//check how many agents there are now, expecting agent not to be included.
function isExcluded(excludeList) {
    return P.resolve(client.node.list_nodes({
        query: {
            online: true,
            skip_cloud_nodes: true,
            skip_mongo_nodes: true
        }
    }))
        .then(res => {
            console.warn(`Node names are ${res.nodes.map(node => node.name)}`);
            const countExclude = res.nodes
                .map(node => node.drives.some(
                    drive => excludeList.includes(drive.dirve_id)
                ))
                .map(Number)
                .reduce((a, b) => a + b);
            if (countExclude === 0) {
                console.warn(`Num of exclude live nodes are ${
                    countExclude} as expected`);
            } else {
                const error = `Num of exclude live nodes are ${
                    countExclude
                    } - something went wrong... expected 0`;
                console.error(error);
                throw new Error(error);
            }
        });
}

function includeExcludeCycle(isInclude) {
    const excludeList = ['E:\\', 'F:\\', '/exclude1', '/exclude2'];
    if (isInclude) {
        console.warn('starting include cycle');
    } else {
        console.warn('starting exclude cycle');
    }
    return getAgentConf(isInclude ? [] : excludeList)
        .then(() => isInclude || runExtensions('map_new_disk', '-r'))
        // creating agents on the VM - diffrent oses.
        .then(() => runCreateAgents(isInclude))
        //verifying write, read, diag and debug level.
        .then(verifyAgent())
        // adding phisical disks to the machines.
        .then(() => (isInclude ? checkIncludeDisk() : checkExcludeDisk(excludeList)))
        //verifying write, read, diag and debug level.
        .then(verifyAgent())
        // Upgrade to same version before uninstalling
        .then(upgradeAgent())
        // // //verifying write, read, diag and debug level after the upgrade.
        .then(verifyAgent())
        // Cleaning the machine Extention and installing new one that remove nodes.
        .then(() => argv.skipsetup || deleteAgent());
}

function main() {
    //running the main cycle:
    return azf.authenticate()
        .then(() => P.fcall(() => client.create_auth_token({
            email: 'demo@noobaa.com',
            password: 'DeMo1',
            system: 'demo'
        })))
        //deleting the VM machines with the same name as the OS we want to install.
        .then(() => {
            if (!argv.skipsetup) {
                return P.map(oses, osname => azf.deleteVirtualMachine(osname)
                    .catch(err => console.log('VM not found - skipping...', err))
                );
            }
        })
        //runing all all the VM machines and deleating all the disks.
        .then(() => {
            if (!argv.skipsetup) {
                return P.map(oses, osname => azf.deleteBlobDisks(osname)
                    .catch(saveErrorAndResume)
                );
            }
        })
        // checking the include disk cycle.
        .then(() => includeExcludeCycle(true))
        // checking the exclude disk cycle.
        // .then(() => includeExcludeCycle(false))
        .catch(saveErrorAndResume)
        .then(() => rpc.disconnect_all())
        .then(() => {
            console.warn('End of Test, cleaning.');
            if (errors.length === 0) {
                if (!argv.skipsetup) {
                    console.log('deleing the virtual machines.');
                    return P.map(oses, osname => azf.deleteVirtualMachine(osname));
                }
                console.log('All is good :) - exiting...');
                process.exit(0);
            } else {
                console.log('Got the following errors in test:');
                _.each(errors, error => {
                    console.error(error);
                });
                console.log('Failures in test :( - exiting...');
                process.exit(1);
            }
        });
}

main();
